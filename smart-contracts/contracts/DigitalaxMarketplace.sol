// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/GSN/Context.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./DigitalaxAccessControls.sol";
import "./garment/IDigitalaxGarmentNFT.sol";

/**
 * @notice Marketplace contract for Digitalax NFTs
 */
contract DigitalaxMarketplace is Context, ReentrancyGuard {
    using SafeMath for uint256;
    using Address for address payable;

    /// @notice Event emitted only on construction. To be used by indexers
    event DigitalaxMarketplaceContractDeployed();

    event PauseToggled(
        bool isPaused
    );

    event OfferCreated(
        uint256 indexed garmentTokenId
    );

    event UpdateMarketplaceExpiryDuration(
        uint256 expiryTime
    );

    event UpdateAccessControls(
        address indexed accessControls
    );

    event UpdateMarketplaceInitialPlatformFee(
        uint256 platformFee
    );

    event UpdateMarketplaceRegularPlatformFee(
        uint256 platformFee
    );

    event UpdateMarketplaceDiscountToPayInErc20(
        uint256 discount
    );

    event UpdatePlatformFeeRecipient(
        address payable platformFeeRecipient
    );

    event OfferPurchased(
        uint256 indexed garmentTokenId,
        address indexed buyer,
        uint256 primarySalePrice,
        uint256 sharePaidInErc20
    );

    event OfferCancelled(
        uint256 indexed garmentTokenId
    );

    /// @notice Parameters of a marketplace offer
    struct Offer {
        uint256 primarySalePrice;
        uint256 startTime;
        uint256 endTime;
        bool resulted;
    }

    /// @notice Garment ERC721 Token ID -> Offer Parameters
    mapping(uint256 => Offer) public offers;

    /// @notice KYC Garment Designers -> Number of times they have sold in this marketplace (To set fee accordingly)
    mapping(address => uint256) public numberOfTimesSold;

    /// @notice Garment ERC721 NFT - the only NFT that can be offered in this contract
    IDigitalaxGarmentNFT public garmentNft;

    // @notice responsible for enforcing admin access
    DigitalaxAccessControls public accessControls;

    /// @notice initial platform fee for first time sellers, assumed to always be to 1 decimal place i.e. 120 = 12.0%
    uint256 public initialPlatformFee = 120;

    /// @notice regular platform fee for returning sellers, assumed to always be to 1 decimal place i.e. 160 = 16.0%
    uint256 public regularPlatformFee = 160;

    /// @notice discount to pay fully in erc20 token (Mona), assumed to always be to 1 decimal place i.e. 20 = 2.0%
    uint256 public discountToPayERC20 = 20;

    /// @notice expiryDuration is approximately 1 month in UNIX Time
    uint256 public expiryDuration = 2600000;

    /// @notice where to send platform fee funds to
    address payable public platformFeeRecipient;

    /// @notice the erc20 token
    address public monaErc20Token;

    /// @notice for switching off marketplace functionalities
    bool public isPaused;

    modifier whenNotPaused() {
        require(!isPaused, "Function is currently paused");
        _;
    }

    constructor(
        DigitalaxAccessControls _accessControls,
        IDigitalaxGarmentNFT _garmentNft,
        address payable _platformFeeRecipient,
        address _monaErc20Token
    ) public {
        require(address(_accessControls) != address(0), "DigitalaxMarketplace: Invalid Access Controls");
        require(address(_garmentNft) != address(0), "DigitalaxMarketplace: Invalid NFT");
        require(_platformFeeRecipient != address(0), "DigitalaxMarketplace: Invalid Platform Fee Recipient");
        require(_monaErc20Token != address(0), "DigitalaxMarketplace: Invalid ERC20 Token");

        accessControls = _accessControls;
        garmentNft = _garmentNft;
        platformFeeRecipient = _platformFeeRecipient;
        monaErc20Token = _monaErc20Token;

        emit DigitalaxMarketplaceContractDeployed();
    }

    /**
     @notice Creates a new offer for a given garment
     @dev Only the owner of a garment can create an offer and must have ALREADY approved the contract
     @dev In addition to owning the garment, the sender also has to have the MINTER role.
     @dev End time for the offer will be in the future, at a time from now till expiry duration
     @param _garmentTokenId Token ID of the garment being offered to marketplace
     @param _primarySalePrice Garment cannot be sold for less than this
     */
    function createOffer(
        uint256 _garmentTokenId,
        uint256 _primarySalePrice
    ) external whenNotPaused {
        // Check owner of the token is the owner and approved
        require(
            garmentNft.ownerOf(_garmentTokenId) == _msgSender() && garmentNft.isApproved(_garmentTokenId, address(this)),
            "DigitalaxMarketplace.createOffer: Not owner and or contract not approved"
        );

        uint256 startTimestamp = _getNow();
        uint256 endTimestamp = startTimestamp.add(expiryDuration);

        _createOffer(
            _garmentTokenId,
            _primarySalePrice,
            startTimestamp,
            endTimestamp
        );
    }

    /**
     @notice Admin or smart contract can list approved Garments
     @dev Sender must have admin or smart contract role
     @dev Owner must have approved this contract for the garment or all garments they own
     @param _garmentTokenId Token ID of the garment being offered
     @param _primarySalePrice Garment cannot be sold for less than this
     */
    function createOfferOnBehalfOfOwner(
        uint256 _garmentTokenId,
        uint256 _primarySalePrice
    ) external {
        // Ensure caller has privileges
        require(
            accessControls.hasAdminRole(_msgSender()) || accessControls.hasSmartContractRole(_msgSender()),
            "DigitalaxMarketplace.createOfferOnBehalfOfOwner: Sender must have admin or smart contract role"
        );

        require(
            garmentNft.isApproved(_garmentTokenId, address(this)),
            "DigitalaxMarketplace.createOfferOnBehalfOfOwner: Cannot create an offer if you do not have approval"
        );

        uint256 startTimestamp = _getNow();
        uint256 endTimestamp = startTimestamp.add(expiryDuration);

        _createOffer(
            _garmentTokenId,
            _primarySalePrice,
            startTimestamp,
            endTimestamp
        );
    }

    /**
     @notice Buys an open offer with eth and/or erc20
     @dev Only callable when the offer is open
     @dev Only callable when the offer is open
     @dev Bids from smart contracts are prohibited
     @param _garmentTokenId Token ID of the garment being offered
     @param _shareErc20 Share from 0 to 100% with 1 decimal places (1000 is max value, meaning the entire amount will be paid in ERC20)
     */
    function buyOffer(uint256 _garmentTokenId, uint256 _shareErc20) external payable nonReentrant whenNotPaused {
        require(_msgSender().isContract() == false, "DigitalaxMarketplace.buyOffer: No contracts permitted");

        // Check the offers to see if this is a valid
        Offer storage offer = offers[_garmentTokenId];


        // Ensure this contract is still approved to move the token
        require(garmentNft.isApproved(_garmentTokenId, address(this)), "DigitalaxMarketplace.buyOffer: offer not approved");

        // Ensure offer not already resulted
        require(!offer.resulted, "DigitalaxMarketplace.buyOffer: offer already resulted");

        // Ensure offer is in flight
        require(
            _getNow() >= offer.startTime && _getNow() <= offer.endTime,
            "DigitalaxMarketplace.buyOffer: Purchase outside of the offer window"
        );

        uint256 maxShare = 1000;
        require(_shareErc20 <= maxShare);

        // Work out platform fee on sale amount
        uint256 computePlatformFee = regularPlatformFee;
        if (numberOfTimesSold[garmentNft.ownerOf(_garmentTokenId)] == 0) {
            computePlatformFee = initialPlatformFee;
        }
        numberOfTimesSold[garmentNft.ownerOf(_garmentTokenId)] += 1;
        uint256 platformFee = offer.primarySalePrice.mul(computePlatformFee).div(1000);
        uint256 finalPurchaseDiscountFromPlatformFee = 0;

        if(_shareErc20 > 0 ) {
            // Calculate the final eth value of the discount thanks to paying partly in the preferred ERC20
            finalPurchaseDiscountFromPlatformFee = offer.primarySalePrice.mul(_shareErc20).mul(discountToPayERC20).div(maxShare);
            // Placeholder value - this will be replaced by the oracle, here we say 100 erc20 tokens / ETH
            uint256 oracleErc20PerEthPlaceholderValue = 100;
            // This is the eth value of the erc20 tokens to be converted. The discount is subtracted from this amount
            uint256 ethValueInOnlyErc20 = offer.primarySalePrice.mul(oracleErc20PerEthPlaceholderValue).sub(finalPurchaseDiscountFromPlatformFee);
            // The platform fee is reduced if someone pays in this manner, the discount does not effect the designer profits
            platformFee = platformFee.sub(finalPurchaseDiscountFromPlatformFee);
            // The amount of actual ERC20 (Preferred) Tokens that needs to be transferred
            uint256 amountOfErc20ToTransfer = (ethValueInOnlyErc20.mul(_shareErc20)).div(maxShare);
            // The remaining eth that needs to be transferred, there is no discount on this value
            uint256 remainingEthToTransfer = offer.primarySalePrice.mul(maxShare.sub(_shareErc20)).div(maxShare);

            // Check that enough eth was sent to move the remaining eth minus the final discount
            require(msg.value >= remainingEthToTransfer, "DigitalaxMarketplace.buyOffer: Failed to supply funds");

            // Check that there is enough ERC20 to cover the rest of the value (minus the discount already taken)
            require(IERC20(monaErc20Token).allowance(msg.sender, address(this)) >= amountOfErc20ToTransfer, "DigitalaxMarketplace.buyOffer: Failed to supply ERC20 Allowance");

            // TODO Do a ERC20 token swap to get some eth back from the erc20 to cover the cost

        } else {
            require(msg.value >= offer.primarySalePrice, "DigitalaxMarketplace.buyOffer: Failed to supply funds");
        }

        // Result of the offer
        offers[_garmentTokenId].resulted = true;

        // Transfer the funds
        // Send platform fee in ETH to the platform fee recipient, there is a discount that is subtracted from this
        (bool platformTransferSuccess,) = platformFeeRecipient.call{value : platformFee.sub(finalPurchaseDiscountFromPlatformFee)}("");
        require(platformTransferSuccess, "DigitalaxMarketplace.buyOffer: Failed to send platform fee");

        // Send remaining to designer in ETH, the discount does not effect this
        (bool designerTransferSuccess,) = garmentNft.garmentDesigners(_garmentTokenId).call{value : offer.primarySalePrice.sub(platformFee)}("");
        require(designerTransferSuccess, "DigitalaxMarketplace.buyOffer: Failed to send the designer their royalties");

        // Record the primary sale price for the garment
        garmentNft.setPrimarySalePrice(_garmentTokenId, offer.primarySalePrice);

        // Transfer the token to the purchaser
        garmentNft.safeTransferFrom(garmentNft.ownerOf(_garmentTokenId), msg.sender, _garmentTokenId);

        emit OfferPurchased(_garmentTokenId, _msgSender(), offer.primarySalePrice, _shareErc20);
    }


    /**
     @notice Cancels and inflight and un-resulted offer
     @dev Only admin
     @param _garmentTokenId Token ID of the garment being offered
     */
    function cancelOffer(uint256 _garmentTokenId) external nonReentrant {
        // Admin only resulting function
        require(
            accessControls.hasAdminRole(_msgSender()) || accessControls.hasSmartContractRole(_msgSender()),
            "DigitalaxMarketplace.cancelOffer: Sender must be admin or smart contract"
        );

        // Check valid and not resulted
        Offer storage offer = offers[_garmentTokenId];

        // Check offer is real
        require(offer.endTime > 0, "DigitalaxMarketplace.cancelOffer: Offer does not exist");

        // Check offer not already resulted
        require(!offer.resulted, "DigitalaxMarketplace.cancelOffer: offer already resulted");

        // Remove offer
        delete offers[_garmentTokenId];

        emit OfferCancelled(_garmentTokenId);
    }

    /**
     @notice Toggling the pause flag
     @dev Only admin
     */
    function toggleIsPaused() external {
        require(accessControls.hasAdminRole(_msgSender()), "DigitalaxMarketplace.toggleIsPaused: Sender must be admin");
        isPaused = !isPaused;
        emit PauseToggled(isPaused);
    }

    /**
     @notice Update the marketplace discount
     @dev Only admin
     @param _marketplaceDiscount New marketplace discount
     */
    function updateMarketplaceDiscountToPayInErc20(uint256 _marketplaceDiscount) external {
        require(accessControls.hasAdminRole(_msgSender()), "DigitalaxMarketplace.updateMarketplaceDiscountToPayInErc20: Sender must be admin");
        require(_marketplaceDiscount < initialPlatformFee, "DigitalaxMarketplace.updateMarketplaceDiscountToPayInErc20: Discount cannot be greater then fee");
        require(_marketplaceDiscount < regularPlatformFee, "DigitalaxMarketplace.updateMarketplaceDiscountToPayInErc20: Discount cannot be greater then fee");

        discountToPayERC20 = _marketplaceDiscount;
        emit UpdateMarketplaceDiscountToPayInErc20(_marketplaceDiscount);
    }

    /**
     @notice Update the marketplace initial fee
     @dev Only admin
     @param _marketplaceInitialFee New marketplace initial fee
     */
    function updateMarketplaceInitialPlatformFee(uint256 _marketplaceInitialFee) external {
        require(accessControls.hasAdminRole(_msgSender()), "DigitalaxMarketplace.updateMarketplaceInitialPlatformFee: Sender must be admin");
        require(_marketplaceInitialFee > discountToPayERC20, "DigitalaxMarketplace.updateMarketplaceInitialPlatformFee: Discount cannot be greater then fee");
        initialPlatformFee = _marketplaceInitialFee;
        emit UpdateMarketplaceInitialPlatformFee(_marketplaceInitialFee);
    }

    /**
     @notice Update the marketplace regular fee
     @dev Only admin
     @param _marketplaceRegularFee New marketplace regular fee
     */
    function updateMarketplaceRegularPlatformFee(uint256 _marketplaceRegularFee) external {
        require(accessControls.hasAdminRole(_msgSender()), "DigitalaxMarketplace.updateMarketplaceRegularPlatformFee: Sender must be admin");
        require(_marketplaceRegularFee > discountToPayERC20, "DigitalaxMarketplace.updateMarketplaceRegularPlatformFee: Discount cannot be greater then fee");
        regularPlatformFee = _marketplaceRegularFee;
        emit UpdateMarketplaceRegularPlatformFee(_marketplaceRegularFee);
    }

    /**
     @notice Update the marketplace sale duration
     @dev Only admin
     @param _expiryDuration New marketplace sale duration
     */
    function updateMarketplaceExpiryDuration(uint256 _expiryDuration) external {
        require(accessControls.hasAdminRole(_msgSender()), "DigitalaxMarketplace.updateMarketplaceExpiryDuration: Sender must be admin");
        expiryDuration = _expiryDuration;
        emit UpdateMarketplaceExpiryDuration(_expiryDuration);
    }

    /**
     @notice Method for updating the access controls contract used by the NFT
     @dev Only admin
     @param _accessControls Address of the new access controls contract (Cannot be zero address)
     */
    function updateAccessControls(DigitalaxAccessControls _accessControls) external {
        require(
            accessControls.hasAdminRole(_msgSender()),
            "DigitalaxMarketplace.updateAccessControls: Sender must be admin"
        );

        require(address(_accessControls) != address(0), "DigitalaxMarketplace.updateAccessControls: Zero Address");

        accessControls = _accessControls;
        emit UpdateAccessControls(address(_accessControls));
    }

    /**
     @notice Method for updating platform fee address
     @dev Only admin
     @param _platformFeeRecipient payable address the address to sends the funds to
     */
    function updatePlatformFeeRecipient(address payable _platformFeeRecipient) external {
        require(
            accessControls.hasAdminRole(_msgSender()),
            "DigitalaxMarketplace.updatePlatformFeeRecipient: Sender must be admin"
        );

        require(_platformFeeRecipient != address(0), "DigitalaxMarketplace.updatePlatformFeeRecipient: Zero address");

        platformFeeRecipient = _platformFeeRecipient;
        emit UpdatePlatformFeeRecipient(_platformFeeRecipient);
    }

    ///////////////
    // Accessors //
    ///////////////

    /**
     @notice Method for getting all info about the offer
     @param _garmentTokenId Token ID of the garment being offered
     */
    function getOffer(uint256 _garmentTokenId)
    external
    view
    returns (uint256 _primarySalePrice, uint256 _startTime, uint256 _endTime, bool _resulted) {
        Offer storage offer = offers[_garmentTokenId];
        return (
        offer.primarySalePrice,
        offer.startTime,
        offer.endTime,
        offer.resulted
        );
    }


    /////////////////////////
    // Internal and Private /
    /////////////////////////

    function _getNow() internal virtual view returns (uint256) {
        return block.timestamp;
    }

    /**
     @notice Private method doing the heavy lifting of creating an offer
     @param _garmentTokenId Token ID of the garment being offered
     @param _primarySalePrice Garment cannot be sold for less than this
     @param _startTimestamp Unix epoch in seconds for the offer start time
     @param _endTimestamp Unix epoch in seconds for the offer end time.
     */
    function _createOffer(
        uint256 _garmentTokenId,
        uint256 _primarySalePrice,
        uint256 _startTimestamp,
        uint256 _endTimestamp
    ) private {
        // Ensure a token cannot be re-listed if previously successfully sold
        require(offers[_garmentTokenId].endTime == 0 || offers[_garmentTokenId].resulted, "DigitalaxMarketplace.createOffer: Cannot duplicate current offer");

        // Check end time not before start time and that end is in the future
        require(_endTimestamp > _startTimestamp, "DigitalaxMarketplace.createOffer: End time must be greater than start");
        require(_endTimestamp > _getNow(), "DigitalaxMarketplace.createOffer: End time passed. Nobody can bid.");

        // Setup the new offer
        offers[_garmentTokenId] = Offer({
        primarySalePrice : _primarySalePrice,
        startTime : _startTimestamp,
        endTime : _endTimestamp,
        resulted : false
        });

        emit OfferCreated(_garmentTokenId);
    }
}
