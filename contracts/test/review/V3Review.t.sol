// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20, VeulClaimsV3} from "../../src/VeulClaimsV3.sol";

contract UsdgR {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function transfer(address to, uint256 a) external returns (bool) { require(balanceOf[msg.sender] >= a, "bal"); balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
}

contract V3ReviewTest is Test {
    UsdgR usdg;
    VeulClaimsV3 c;
    address owner = makeAddr("owner");
    address poster = makeAddr("poster");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address thief = makeAddr("thief");

    function leaf(address w, uint256 a) internal pure returns (bytes32) { return keccak256(bytes.concat(keccak256(abi.encode(w, a)))); }
    function pair(bytes32 a, bytes32 b) internal pure returns (bytes32) { return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a)); }

    function setUp() public {
        usdg = new UsdgR();
        c = new VeulClaimsV3(IERC20(address(usdg)), address(0xbeef), owner);
        vm.startPrank(owner);
        c.setPoster(poster);
        c.setLimits(50e6, 20 hours);
        c.setPayoutLimit(25e6, 1 days);
        vm.stopPrank();
    }

    /// After a poster-key theft and the owner's correction, setRoot's funding check and rescue's guard both
    /// count the thief's payout as if it had gone to honest wallets: the contract accepts a root it cannot pay,
    /// and rescue releases USDG honest wallets are still owed.
    function test_afterTheft_fundingAndRescueGuardsAreWrong() public {
        usdg.mint(address(c), 100e6);
        vm.prank(owner);
        c.setRoot(leaf(alice, 100e6), 100e6); // alice owed 100, fully funded
        vm.warp(block.timestamp + 20 hours);
        vm.prank(poster); // stolen key: thief gets 100, total unchanged
        c.setRoot(leaf(thief, 100e6), 100e6);
        vm.prank(thief);
        c.claim(100e6, new bytes32[](0)); // takes the 25 budget
        assertEq(usdg.balanceOf(thief), 25e6);

        // Owner pauses, rotates poster, posts the honest tree again (alice 100, thief 0 -> total 100).
        vm.startPrank(owner);
        c.setPaused(true);
        c.setPoster(address(0));
        bytes32 a = leaf(alice, 100e6);
        bytes32 t = leaf(thief, 0);
        c.setRoot(pair(a, t), 100e6); // accepted: balance 75 + totalClaimed 25 >= 100, but alice needs 100
        // rescue: stillOwed = 100 - 25 = 75 = balance -> nothing free here; add 10 of "excess" and check
        vm.stopPrank();
        usdg.mint(address(c), 10e6); // owner tops up 10 toward the 25 shortfall
        vm.prank(owner);
        c.rescue(address(usdg), owner, 10e6); // guard lets the top-up straight back out
        assertEq(usdg.balanceOf(address(c)), 75e6, "contract holds 75 while alice is owed 100");
    }

    /// The owner cannot shrink rootTotal either, so a thief's inflation (up to maxIncrease per day) is permanent:
    /// honest roots must keep a padding leaf and the padded USDG can never be rescued.
    /// Re-review C2, fixed: the owner can now post the honest, lower total, and rescue then works.
    function test_inflatedTotalCanBeUndone() public {
        usdg.mint(address(c), 150e6);
        vm.prank(owner);
        c.setRoot(leaf(alice, 100e6), 100e6);
        vm.warp(block.timestamp + 20 hours);
        vm.prank(poster);
        c.setRoot(leaf(thief, 150e6), 150e6); // +50
        vm.prank(owner);
        c.setRoot(leaf(alice, 100e6), 100e6);
        vm.prank(owner);
        c.rescue(address(usdg), owner, 50e6);
        assertEq(usdg.balanceOf(owner), 50e6);
    }

    /// One wallet owed more than maxPayout can take every refill by claiming each block; others get nothing.
    function test_whaleMonopolisesBudget() public {
        usdg.mint(address(c), 1_000e6);
        bytes32 a = leaf(alice, 900e6);
        bytes32 b = leaf(bob, 1e6);
        vm.prank(owner);
        c.setRoot(pair(a, b), 901e6);
        bytes32[] memory pa = new bytes32[](1); pa[0] = b;
        bytes32[] memory pb = new bytes32[](1); pb[0] = a;
        vm.prank(alice);
        c.claim(900e6, pa);
        for (uint256 i = 0; i < 100; i++) {
            vm.warp(block.timestamp + 2);
            vm.prank(alice); // alice's tx lands first in each block
            c.claim(900e6, pa);
            vm.prank(bob);
            vm.expectRevert(VeulClaimsV3.PayoutBudgetEmpty.selector);
            c.claim(1e6, pb);
        }
        assertEq(c.claimed(bob), 0);
    }
}
