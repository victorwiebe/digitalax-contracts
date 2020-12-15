pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./uniswapv2/interfaces/IUniswapV2Router02.sol";

//console
import "@nomiclabs/buidler/console.sol";
contract DigitalaxSwapMaker {

    IUniswapV2Router02 uniswapV2Router02;
    address public mona;
    address public weth;
    
    constructor(IUniswapV2Router02 _uniswapV2Router02, address _mona, address _weth) public {
        uniswapV2Router02 = IUniswapV2Router02(_uniswapV2Router02);
        mona = _mona;
        weth = _weth;
    }

    function SellMona(uint256 amountIn) external  returns(bool)
    {
        require(IERC20(mona).transferFrom(msg.sender, address(this), amountIn), 'transferFrom failed.');
        require(IERC20(mona).approve(address(uniswapV2Router02), amountIn), 'approve failed.');

        address[] memory path = new address[](2);
        path[0] = mona;
        path[1] = uniswapV2Router02.WETH();

        uniswapV2Router02.swapExactTokensForETH(amountIn, 0, path, msg.sender, block.timestamp);

        return true;
    }
    

}