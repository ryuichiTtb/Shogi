// Issue #150: vitest 用に server-only を no-op に置換するシム。
// 実プロダクションでは server-only パッケージが「Client Component から import すると build エラー」
// にする番人として機能するが、vitest はその境界を持たないため、ここで empty module に差し替える。
export {};
