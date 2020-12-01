// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../DigitalaxMarketplace.sol";

contract DigitalaxMarketplaceMock is DigitalaxMarketplace {
    uint256 public nowOverride;

    constructor(
        DigitalaxAccessControls _accessControls,
        IDigitalaxGarmentNFT _garmentNft,
        address payable _platformReserveAddress,
        address _monaErc20Token
    )
    DigitalaxMarketplace(_accessControls, _garmentNft, _platformReserveAddress, _monaErc20Token)
    public {}

    function setNowOverride(uint256 _now) external {
        nowOverride = _now;
    }

    function _getNow() internal override view returns (uint256) {
        return nowOverride;
    }
}
