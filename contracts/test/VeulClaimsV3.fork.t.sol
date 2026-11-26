// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20, VeulClaimsV3} from "../src/VeulClaimsV3.sol";

interface IV3Pool {
    function fee() external view returns (uint24);
}

/// Claims on a fork of Robinhood Chain mainnet, through the real Universal Router and the real USDG pools:
/// NVDA (v3 pool) and SPY (v4 pool). The router calldata is encoded here exactly as web/src/lib/swap/encode.ts
/// builds it for claims (recipient = the trader, payer = router, amount = the router's USDG balance).
/// Run: RH_RPC_URL=<robinhood chain rpc> forge test --match-contract Fork
/// v2: every root here is posted by the limited poster key, as the daily job does.
contract VeulClaimsV3ForkTest is Test {
    address constant ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant NVDA_POOL = 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3; // NVDA/USDG v3
    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    bytes32 constant SPY_POOL_ID = 0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd; // SPY/USDG v4

    uint256 constant CONTRACT_BALANCE = 1 << 255;

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    VeulClaimsV3 claims;
    address owner = makeAddr("owner");
    address poster = makeAddr("poster");
    address trader = makeAddr("trader");

    function setUp() public {
        string memory rpc = vm.envOr("RH_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        claims = new VeulClaimsV3(IERC20(USDG), ROUTER, owner);
        vm.startPrank(owner);
        claims.setPoster(poster);
        claims.setLimits(100e6, 20 hours); // at most 100 USDG a root, one root a day
        claims.setPayoutLimit(25e6, 1 days); // at most 25 USDG paid out a day
        vm.stopPrank();
    }

    /// One-leaf tree: the root is the leaf and the proof is empty.
    function postSingle(address wallet, uint256 cumulative) internal returns (bytes32[] memory proof) {
        // Fund from the NVDA pool, which holds plenty of USDG on mainnet.
        vm.prank(NVDA_POOL);
        IERC20(USDG).transfer(address(claims), cumulative);
        bytes32 root = keccak256(bytes.concat(keccak256(abi.encode(wallet, cumulative))));
        vm.prank(poster);
        claims.setRoot(root, cumulative);
        proof = new bytes32[](0);
    }

    function test_fork_claimIntoNvdaV3() public {
        uint256 amount = 25e6; // 25 USDG
        bytes32[] memory proof = postSingle(trader, amount);

        uint24 fee = IV3Pool(NVDA_POOL).fee();
        bytes memory path = abi.encodePacked(USDG, fee, NVDA);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(trader, CONTRACT_BALANCE, uint256(1), path, false, new uint256[](0));
        bytes memory call = abi.encodeWithSignature("execute(bytes,bytes[],uint256)", hex"00", inputs, block.timestamp + 600);

        vm.prank(trader);
        (uint256 paid, uint256 received) = claims.claimAndSwap(amount, proof, call, IERC20(NVDA), 1, type(uint256).max);
        assertEq(paid, amount);
        assertGt(received, 0);
        assertEq(IERC20(NVDA).balanceOf(trader), received);
        assertEq(IERC20(USDG).balanceOf(address(claims)), 0);
        emit log_named_uint("NVDA received for 25 USDG (18 decimals)", received);
    }

    function test_fork_claimIntoSpyV4() public {
        uint256 amount = 25e6;
        bytes32[] memory proof = postSingle(trader, amount);

        PoolKey memory key = findHooklessKey(SPY_POOL_ID, USDG, SPY);
        bool zeroForOne = key.currency0 == USDG;

        bytes memory actions = hex"0b060e"; // SETTLE, SWAP_EXACT_IN_SINGLE, TAKE
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(USDG, CONTRACT_BALANCE, false);
        params[1] = abi.encode(ExactInputSingleParams(key, zeroForOne, 0, 1, 0, ""));
        params[2] = abi.encode(SPY, trader, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        bytes memory call = abi.encodeWithSignature("execute(bytes,bytes[],uint256)", hex"10", inputs, block.timestamp + 600);

        vm.prank(trader);
        (, uint256 received) = claims.claimAndSwap(amount, proof, call, IERC20(SPY), 1, type(uint256).max);
        assertGt(received, 0);
        assertEq(IERC20(SPY).balanceOf(trader), received);
        emit log_named_uint("SPY received for 25 USDG (18 decimals)", received);
    }

    function test_fork_claimAsUsdg() public {
        uint256 amount = 3e6;
        bytes32[] memory proof = postSingle(trader, amount);
        vm.prank(trader);
        claims.claim(amount, proof);
        assertEq(IERC20(USDG).balanceOf(trader), amount);
    }

    /// The v4 pool key behind an id, for a hookless pool: try the common fee / tick spacing pairs.
    function findHooklessKey(bytes32 id, address a, address b) internal pure returns (PoolKey memory key) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        uint24[6] memory fees = [uint24(100), 500, 3000, 10000, 2500, 50];
        int24[5] memory spacings = [int24(1), 10, 60, 200, 50];
        for (uint256 f = 0; f < fees.length; f++) {
            for (uint256 s = 0; s < spacings.length; s++) {
                key = PoolKey(c0, c1, fees[f], spacings[s], address(0));
                if (keccak256(abi.encode(key)) == id) return key;
            }
        }
        revert("pool key not found");
    }
}
