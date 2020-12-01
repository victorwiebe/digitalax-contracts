const {
  expectRevert,
  expectEvent,
  BN,
  ether,
  constants,
  balance
} = require('@openzeppelin/test-helpers');

const {expect} = require('chai');

const DigitalaxAccessControls = artifacts.require('DigitalaxAccessControls');
const DigitalaxMaterials = artifacts.require('DigitalaxMaterials');
const DigitalaxGarmentNFT = artifacts.require('DigitalaxGarmentNFT');
const DigitalaxMarketplace = artifacts.require('DigitalaxMarketplaceMock');
const DigitalaxMarketplaceReal = artifacts.require('DigitalaxMarketplace');
const MockERC20 = artifacts.require('MockERC20');
const MarketplaceBuyingContractMock = artifacts.require('MarketplaceBuyingContractMock');

// 1,000 * 10 ** 18
const ONE_THOUSAND_TOKENS = '1000000000000000000000';

contract('DigitalaxMarketplace', (accounts) => {
  const [admin, smartContract, platformFeeAddress, minter, owner, designer, tokenBuyer, newRecipient] = accounts;

  const TOKEN_ONE_ID = new BN('1');
  const TOKEN_TWO_ID = new BN('2');

  const randomTokenURI = 'rand';

  beforeEach(async () => {
    this.accessControls = await DigitalaxAccessControls.new({from: admin});
    await this.accessControls.addMinterRole(minter, {from: admin});
    await this.accessControls.addSmartContractRole(smartContract, {from: admin});

    this.monaToken = this.token = await MockERC20.new(
        'MONA',
        'MONA',
        ONE_THOUSAND_TOKENS,
        {from: tokenBuyer}
    );

    this.digitalaxMaterials = await DigitalaxMaterials.new(
      'DigitalaxMaterials',
      'DXM',
      this.accessControls.address,
      {from: owner}
    );

    this.token = await DigitalaxGarmentNFT.new(
      this.accessControls.address,
      this.digitalaxMaterials.address,
      {from: admin}
    );

    this.marketplace = await DigitalaxMarketplace.new(
      this.accessControls.address,
      this.token.address,
      platformFeeAddress,
      this.monaToken.address,
      {from: admin}
    );

    this.monaToken.approve(this.marketplace.address, ONE_THOUSAND_TOKENS);

    await this.accessControls.addSmartContractRole(this.marketplace.address, {from: admin});
  });

  describe('Contract deployment', () => {
    it('Reverts when access controls is zero', async () => {
      await expectRevert(
        DigitalaxMarketplace.new(
          constants.ZERO_ADDRESS,
          this.token.address,
          platformFeeAddress,
            this.monaToken.address,
          {from: admin}
        ),
        "DigitalaxMarketplace: Invalid Access Controls"
      );
    });

    it('Reverts when garment is zero', async () => {
      await expectRevert(
        DigitalaxMarketplace.new(
          this.accessControls.address,
          constants.ZERO_ADDRESS,
          platformFeeAddress,
            this.monaToken.address,
          {from: admin}
        ),
        "DigitalaxMarketplace: Invalid NFT"
      );
    });

    it('Reverts when platform fee recipient is zero', async () => {
      await expectRevert(
        DigitalaxMarketplace.new(
          this.accessControls.address,
          this.token.address,
          constants.ZERO_ADDRESS,
          this.monaToken.address,
          {from: admin}
        ),
        "DigitalaxMarketplace: Invalid Platform Fee Recipient"
      );
    });
    it('Reverts when mona token address is zero', async () => {
      await expectRevert(
        DigitalaxMarketplace.new(
          this.accessControls.address,
          this.token.address,
          platformFeeAddress,
          constants.ZERO_ADDRESS,
          {from: admin}
        ),
        "DigitalaxMarketplace: Invalid ERC20 Token"
      );
    });
  });

  describe('Admin functions', () => {
    beforeEach(async () => {
      await this.token.mint(minter, randomTokenURI, designer, {from: minter});
      await this.token.approve(this.marketplace.address, TOKEN_ONE_ID, {from: minter});
      await this.marketplace.setNowOverride('2');
      await this.marketplace.createOffer(
        TOKEN_ONE_ID,
        ether('0.1'),  // Price of 1 eth
        {from: minter}
      );
    });

    describe('updateMarketplaceInitialPlatformFee()', () => {
      it('fails when not admin', async () => {
        await expectRevert(
          this.marketplace.updateMarketplaceInitialPlatformFee(200, {from: tokenBuyer}),
          'DigitalaxMarketplace.updateMarketplaceInitialPlatformFee: Sender must be admin'
        );
      });
      it('fails when less than the discount', async () => {
        const discount = await this.marketplace.discountToPayERC20();
        expect(discount).to.be.bignumber.equal('20');
        await expectRevert(
          this.marketplace.updateMarketplaceInitialPlatformFee(10, {from: admin}),
          'DigitalaxMarketplace.updateMarketplaceInitialPlatformFee: Discount cannot be greater then fee'
        );
      });
      it('successfully updates initial platform fee', async () => {
        const original = await this.marketplace.initialPlatformFee();
        expect(original).to.be.bignumber.equal('120');

        await this.marketplace.updateMarketplaceInitialPlatformFee('200', {from: admin});

        const updated = await this.marketplace.initialPlatformFee();
        expect(updated).to.be.bignumber.equal('200');
      });
    });

    describe('updateMarketplaceRegularPlatformFee()', () => {
      it('fails when not admin', async () => {
        await expectRevert(
          this.marketplace.updateMarketplaceRegularPlatformFee(200, {from: tokenBuyer}),
          'DigitalaxMarketplace.updateMarketplaceRegularPlatformFee: Sender must be admin'
        );
      });
      it('fails when less than the discount', async () => {
        const discount = await this.marketplace.discountToPayERC20();
        expect(discount).to.be.bignumber.equal('20');
        await expectRevert(
          this.marketplace.updateMarketplaceRegularPlatformFee(10, {from: admin}),
          'DigitalaxMarketplace.updateMarketplaceRegularPlatformFee: Discount cannot be greater then fee'
        );
      });
      it('successfully updates regular platform fee', async () => {
        const original = await this.marketplace.regularPlatformFee();
        expect(original).to.be.bignumber.equal('160');

        await this.marketplace.updateMarketplaceRegularPlatformFee(200, {from: admin});

        const updated = await this.marketplace.regularPlatformFee();
        expect(updated).to.be.bignumber.equal('200');
      });
    });

    describe('updateMarketplaceDiscountToPayInErc20()', () => {
      it('fails when not admin', async () => {
        await expectRevert(
            this.marketplace.updateMarketplaceDiscountToPayInErc20(10, {from: tokenBuyer}),
            'DigitalaxMarketplace.updateMarketplaceDiscountToPayInErc20: Sender must be admin'
        );
      });
      it('fails when more than the platform fee', async () => {
        const initialPlatformFee = await this.marketplace.initialPlatformFee();
        expect(initialPlatformFee).to.be.bignumber.equal('120');
        const regularPlatformFee = await this.marketplace.regularPlatformFee();
        expect(regularPlatformFee).to.be.bignumber.equal('160');
        await expectRevert(
            this.marketplace.updateMarketplaceDiscountToPayInErc20(200, {from: admin}),
            'DigitalaxMarketplace.updateMarketplaceDiscountToPayInErc20: Discount cannot be greater then fee'
        );
      });
      it('successfully updates discount', async () => {
        const original = await this.marketplace.discountToPayERC20();
        expect(original).to.be.bignumber.equal('20');

        await this.marketplace.updateMarketplaceDiscountToPayInErc20(30, {from: admin});

        const updated = await this.marketplace.discountToPayERC20();
        expect(updated).to.be.bignumber.equal('30');
      });
    });

    describe('updateMarketplaceExpiryDuration()', () => {
      it('fails when not admin', async () => {
        await expectRevert(
            this.marketplace.updateMarketplaceExpiryDuration(200, {from: tokenBuyer}),
            'DigitalaxMarketplace.updateMarketplaceExpiryDuration: Sender must be admin'
        );
      });
      it('successfully updates expiry duration', async () => {
        const original = await this.marketplace.expiryDuration();
        expect(original).to.be.bignumber.equal('2600000');

        await this.marketplace.updateMarketplaceExpiryDuration(3600000, {from: admin});

        const updated = await this.marketplace.expiryDuration();
        expect(updated).to.be.bignumber.equal('3600000');
      });
    });

    describe('updateAccessControls()', () => {
      it('fails when not admin', async () => {
        await expectRevert(
          this.marketplace.updateAccessControls(this.accessControls.address, {from: tokenBuyer}),
          'DigitalaxMarketplace.updateAccessControls: Sender must be admin'
        );
      });

      it('reverts when trying to set recipient as ZERO address', async () => {
        await expectRevert(
          this.marketplace.updateAccessControls(constants.ZERO_ADDRESS, {from: admin}),
          'DigitalaxMarketplace.updateAccessControls: Zero Address'
        );
      });

      it('successfully updates access controls', async () => {
        const accessControlsV2 = await DigitalaxAccessControls.new({from: admin});

        const original = await this.marketplace.accessControls();
        expect(original).to.be.equal(this.accessControls.address);

        await this.marketplace.updateAccessControls(accessControlsV2.address, {from: admin});

        const updated = await this.marketplace.accessControls();
        expect(updated).to.be.equal(accessControlsV2.address);
      });
    });

    describe('updatePlatformFeeRecipient()', () => {
      it('reverts when not admin', async () => {
        await expectRevert(
          this.marketplace.updatePlatformFeeRecipient(owner, {from: tokenBuyer}),
          'DigitalaxMarketplace.updatePlatformFeeRecipient: Sender must be admin'
        );
      });

      it('reverts when trying to set recipient as ZERO address', async () => {
        await expectRevert(
          this.marketplace.updatePlatformFeeRecipient(constants.ZERO_ADDRESS, {from: admin}),
          'DigitalaxMarketplace.updatePlatformFeeRecipient: Zero address'
        );
      });

      it('successfully updates platform fee recipient', async () => {
        const original = await this.marketplace.platformFeeRecipient();
        expect(original).to.be.equal(platformFeeAddress);

        await this.marketplace.updatePlatformFeeRecipient(newRecipient, {from: admin});

        const updated = await this.marketplace.platformFeeRecipient();
        expect(updated).to.be.equal(newRecipient);
      });
    });

    describe('toggleIsPaused()', () => {
      it('can successfully toggle as admin', async () => {
        expect(await this.marketplace.isPaused()).to.be.false;

        const {receipt} = await this.marketplace.toggleIsPaused({from: admin});
        await expectEvent(receipt, 'PauseToggled', {
          isPaused: true
        });

        expect(await this.marketplace.isPaused()).to.be.true;
      })

      it('reverts when not admin', async () => {
        await expectRevert(
          this.marketplace.toggleIsPaused({from: tokenBuyer}),
          "DigitalaxMarketplace.toggleIsPaused: Sender must be admin"
        );
      })
    });
  });

  describe('createOffer()', async () => {

    describe('validation', async () => {
      beforeEach(async () => {
        await this.token.mint(minter, randomTokenURI, designer, {from: minter});
        await this.token.approve(this.marketplace.address, TOKEN_ONE_ID, {from: minter});
      });


      it('fails if token already has marketplace in play', async () => {
        await this.marketplace.setNowOverride('2');
        await this.marketplace.createOffer(TOKEN_ONE_ID, ether('0.1'), {from: minter});

        await expectRevert(
          this.marketplace.createOffer(TOKEN_ONE_ID,  ether('0.1'), {from: minter}),
          'DigitalaxMarketplace.createOffer: Cannot duplicate current offer'
        );
      });

      it('fails if you dont own the token', async () => {
        await this.marketplace.setNowOverride('2');
        await this.token.mint(tokenBuyer, randomTokenURI, designer, {from: minter});

        await this.marketplace.createOffer(TOKEN_ONE_ID, ether('0.1'), {from: minter});

        await expectRevert(
          this.marketplace.createOffer(TOKEN_ONE_ID, ether('0.1'), {from: minter}),
          'DigitalaxMarketplace.createOffer: Cannot duplicate current offer'
        );
      });

      it('fails if token does not exist', async () => {
        await this.marketplace.setNowOverride('10');

        await expectRevert(
          this.marketplace.createOffer('99', ether('0.1'), {from: minter}),
          'ERC721: owner query for nonexistent token'
        );
      });

      it('fails if contract is paused', async () => {
        await this.marketplace.setNowOverride('2');
        await this.marketplace.toggleIsPaused({from: admin});
        await expectRevert(
           this.marketplace.createOffer('99', ether('0.1'), {from: minter}),
          "Function is currently paused"
        );
      });
    });

    describe('successful creation', async () => {
      it('Token retains in the ownership of the marketplace creator', async () => {
        await this.marketplace.setNowOverride('2');
        await this.token.mint(minter, randomTokenURI, designer, {from: minter});
        await this.token.approve(this.marketplace.address, TOKEN_ONE_ID, {from: minter});
        await this.marketplace.createOffer(TOKEN_ONE_ID, ether('0.1'), {from: minter});

        const owner = await this.token.ownerOf(TOKEN_ONE_ID);
        expect(owner).to.be.equal(minter);
      });
    });

    describe('creating using real contract (not mock)', () => {
      it('can successfully create', async () => {
        const marketplace = await DigitalaxMarketplaceReal.new(
          this.accessControls.address,
          this.token.address,
          platformFeeAddress,
            this.monaToken.address,
          {from: admin}
        );

        await this.token.mint(minter, randomTokenURI, designer, {from: minter});
        await this.token.approve(marketplace.address, TOKEN_ONE_ID, {from: minter});
        await marketplace.createOffer(TOKEN_ONE_ID, ether('0.1'), {from: minter});

        const owner = await this.token.ownerOf(TOKEN_ONE_ID);
        expect(owner).to.be.equal(minter);
      });
    });
  });

  // TODO
  // describe('createAuctionOnBehalfOfOwner()', () => {
  //   beforeEach(async () => {
  //     await this.marketplace.setNowOverride('2');
  //     await this.token.mint(minter, randomTokenURI, designer, {from: minter});
  //   });
  //
  //   describe('validation', () => {
  //     it('fails when sender does not have admin or smart contract role', async () => {
  //       await expectRevert(
  //         this.marketplace.createAuctionOnBehalfOfOwner(TOKEN_ONE_ID, "0", "0", "10", {from: tokenBuyer}),
  //         "DigitalaxMarketplace.createAuctionOnBehalfOfOwner: Sender must have admin or smart contract role"
  //       );
  //     });
  //
  //     it('fails when marketplace does not have approval for garment', async () => {
  //       await expectRevert(
  //         this.marketplace.createAuctionOnBehalfOfOwner(TOKEN_ONE_ID, "0", "0", "10", {from: admin}),
  //         "DigitalaxMarketplace.createAuctionOnBehalfOfOwner: Cannot create an marketplace if you do not have approval"
  //       );
  //     });
  //   });
  //
  //   describe('successful creation', () => {
  //     beforeEach(async () => {
  //       await this.token.approve(this.marketplace.address, TOKEN_ONE_ID, {from: minter});
  //     });
  //
  //     const createAuctionOnBehalfOfOwnerGivenSenderIs = async (sender) => {
  //       const {receipt} = await this.marketplace.createAuctionOnBehalfOfOwner(TOKEN_ONE_ID, "0", "0", "10", {from: sender});
  //
  //       await expectEvent(receipt, 'AuctionCreated', {
  //         garmentTokenId: TOKEN_ONE_ID
  //       });
  //
  //       const {_reservePrice, _startTime, _endTime, _resulted} = await this.marketplace.getAuction(TOKEN_ONE_ID);
  //       expect(_reservePrice).to.be.bignumber.equal('0');
  //       expect(_startTime).to.be.bignumber.equal('0');
  //       expect(_endTime).to.be.bignumber.equal('10');
  //       expect(_resulted).to.be.equal(false);
  //
  //       const owner = await this.token.ownerOf(TOKEN_ONE_ID);
  //       expect(owner).to.be.equal(minter);
  //     };
  //
  //     it('succeeds with admin role', async () => {
  //       await createAuctionOnBehalfOfOwnerGivenSenderIs(admin);
  //     });
  //
  //
  //     it('succeeds with smart contract role', async () => {
  //       await createAuctionOnBehalfOfOwnerGivenSenderIs(smartContract);
  //     });
  //   });
  // });

  describe('buyOffer()', async () => {

    describe('validation', () => {

      beforeEach(async () => {
        await this.token.mint(minter, randomTokenURI, designer, {from: minter});
        await this.token.mint(minter, randomTokenURI, designer, {from: minter});
        await this.marketplace.setNowOverride('2');

        await this.token.approve(this.marketplace.address, TOKEN_ONE_ID, {from: minter});
        await this.token.approve(this.marketplace.address, TOKEN_TWO_ID, {from: minter});
        await this.marketplace.createOffer(
          TOKEN_ONE_ID, // ID
          ether('0.1'),
          {from: minter}
        );
      });

      // TODO
      // it('will revert if sender is smart contract', async () => {
      //   this.biddingContract = await MarketplaceBuyingContractMock.new(this.accessControls.address,
      //       this.token.address,
      //       platformFeeAddress,
      //       this.monaToken.address,
      //       {from: admin});
      //   await expectRevert(
      //     this.biddingContract.buyOffer(TOKEN_ONE_ID, 0, {from: tokenBuyer, value: ether('0.1')}),
      //     "DigitalaxMarketplace.buyOffer: No contracts permitted"
      //   );
      // });

      it('will fail when contract is paused', async () => {
        await this.marketplace.toggleIsPaused({from: admin});
        await expectRevert(
          this.marketplace.buyOffer(TOKEN_ONE_ID, 0, {from: tokenBuyer, value: ether('1.0')}),
          "Function is currently paused"
        );
      });
    });

    describe('successfully buys offer', () => {

      beforeEach(async () => {
        await this.token.mint(minter, randomTokenURI, designer, {from: minter});
        await this.token.approve(this.marketplace.address, TOKEN_ONE_ID, {from: minter});
        await this.marketplace.setNowOverride('1');
        await this.marketplace.createOffer(
          TOKEN_ONE_ID, // ID
          ether('0.1'),
          {from: minter}
        );
      });

      it('buys the offer', async () => {
        await this.marketplace.setNowOverride('2');
        await this.marketplace.buyOffer(TOKEN_ONE_ID, 0, {from: tokenBuyer, value: ether('0.1')});

        const {_primarySalePrice, _startTime, _endTime, _resulted} = await this.marketplace.getOffer(TOKEN_ONE_ID);
        expect(_primarySalePrice).to.be.bignumber.equal(ether('0.1'));
        expect(_startTime).to.be.bignumber.equal('1');
        expect(_endTime).to.be.bignumber.equal('2600001');
        expect(_resulted).to.be.equal(true);
      });

      // TODO
      // it('transfer funds to the token creator and platform', async () => {
      //   await this.marketplace.buyOffer(TOKEN_ONE_ID, 0, {from: tokenBuyer, value: ether('0.1')});
      //   await this.marketplace.setNowOverride('12');
      //
      //   const platformFeeTracker = await balance.tracker(platformFeeAddress);
      //   const designerTracker = await balance.tracker(designer);
      //
      //   // Platform gets 12%
      //   const platformChanges = await platformFeeTracker.delta('wei');
      //   expect(platformChanges).to.be.bignumber.equal(
      //     (ether('0.4').sub(ether('0.1'))) // total minus reserve
      //       .div(new BN('1000'))
      //       .mul(new BN('120')) // only 12% of total
      //   );
      //
      //   // Remaining funds sent to designer on completion
      //   const changes = await designerTracker.delta('wei');
      //   expect(changes).to.be.bignumber.equal(
      //     ether('0.4').sub(platformChanges)
      //   );
      // });

      it('records primary sale price on garment NFT', async () => {
        await this.marketplace.buyOffer(TOKEN_ONE_ID, 0, {from: tokenBuyer, value: ether('0.4')});
        await this.marketplace.setNowOverride('12');

        const primarySalePrice = await this.token.primarySalePrice(TOKEN_ONE_ID);
        expect(primarySalePrice).to.be.bignumber.equal(ether('0.1'));
      });
    });
  });

  describe('cancelOffer()', async () => {

    beforeEach(async () => {
      await this.token.mint(minter, randomTokenURI, designer, {from: minter});
      await this.token.approve(this.marketplace.address, TOKEN_ONE_ID, {from: minter});
      await this.marketplace.setNowOverride('2');
      await this.marketplace.createOffer(
        TOKEN_ONE_ID,
        ether('0.1'),
        {from: minter}
      );
    });

    describe('validation', async () => {

      it('cannot cancel if not an admin', async () => {
        await expectRevert(
          this.marketplace.cancelOffer(TOKEN_ONE_ID, {from: tokenBuyer}),
          'DigitalaxMarketplace.cancelOffer: Sender must be admin or smart contract'
        );
      });

      it('cannot cancel if marketplace already cancelled', async () => {
        await this.marketplace.buyOffer(TOKEN_ONE_ID, 0, {from: tokenBuyer, value: ether('0.2')});
        await this.marketplace.setNowOverride('12');

        await expectRevert(
          this.marketplace.cancelOffer(TOKEN_ONE_ID, {from: admin}),
          'revert DigitalaxMarketplace.cancelOffer: offer already resulted'
        );
      });

      it('cannot cancel if marketplace does not exist', async () => {
        await expectRevert(
          this.marketplace.cancelOffer(9999, {from: admin}),
          'DigitalaxMarketplace.cancelOffer: Offer does not exist'
        );
      });
  });
  });

  async function getGasCosts(receipt) {
    const tx = await web3.eth.getTransaction(receipt.tx);
    const gasPrice = new BN(tx.gasPrice);
    return gasPrice.mul(new BN(receipt.receipt.gasUsed));
  }
});
