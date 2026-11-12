# Minimum-Square Partition of a Blocked Grid

## Problem

Given an `N × N` grid with `B` arbitrarily placed blocked cells, partition all `N² − B` non-blocked cells into the smallest possible number of squares.

Each selected square must:

- Have a positive integer side length and align with the grid.
- Stay entirely inside the grid.
- Contain no blocked cells.
- Share no cells with any other selected square. Squares may touch along edges or corners.

Every non-blocked cell must belong to exactly one selected square. Squares may have different side lengths.

The objective is to minimize the number of squares, not merely to maximize the largest square. Choosing the largest available square greedily does not guarantee the minimum count.

## Input and output

**Input:** A positive integer `N` and a set of `B` distinct blocked cell coordinates, where `0 ≤ B ≤ N²`. Rows and columns are indexed from `0` to `N − 1`.

**Output:** A minimum-size list of squares. Represent each square as `(row, column, side_length)`, where `(row, column)` is its top-left cell.

If all cells are blocked, return an empty list. Otherwise, a solution always exists because each non-blocked cell can be covered by a `1 × 1` square.

## Exact algorithm: backtracking with branch-and-bound

Maintain the currently uncovered cells, the squares selected so far, and the best complete solution found.

1. Initialize the best solution with one `1 × 1` square for every non-blocked cell. This gives a valid upper bound on the minimum count.
2. Find the first uncovered cell in row-major order: top to bottom, then left to right.
3. Find the largest square with its top-left corner at this cell that consists entirely of uncovered, non-blocked cells and stays inside the grid.
4. Try every side length from that maximum down to `1`:
   - Add the square to the current solution.
   - Mark its cells covered.
   - Recursively solve the remaining uncovered region.
   - Undo the placement before trying the next size.
5. When no uncovered cells remain, save the current solution if it uses fewer squares than the best solution.
6. Stop exploring any branch whose current square count is already at least the best complete count. Further placements cannot improve it.

Trying larger squares first can help find a good complete solution early. All feasible sizes must still be considered unless a valid bound prunes the branch.

## Pseudocode

```text
minimum_square_partition(N, blocked):
    uncovered = all grid cells except blocked
    best = [(r, c, 1) for each cell (r, c) in uncovered]
    chosen = []

    search():
        if uncovered is empty:
            if length(chosen) < length(best):
                best = copy(chosen)
            return

        if length(chosen) >= length(best):
            return

        (r, c) = first cell in uncovered in row-major order
        max_side = largest side length such that the square
                   at (r, c) stays inside the grid and every
                   cell of the square belongs to uncovered

        for side from max_side down to 1:
            square = (r, c, side)
            remove square's cells from uncovered
            append square to chosen

            search()

            remove last square from chosen
            restore square's cells to uncovered

    search()
    return best
```

`best` is shared across recursive calls. Saved solutions must be copied so that later backtracking does not modify them.

## Why this finds an optimum

Let `(r, c)` be the first uncovered cell. In any valid completion of the current partial solution, the square covering this cell must have its top-left corner at `(r, c)`.

If that square started in an earlier row or an earlier column of the same row, its top-left cell would precede `(r, c)` in scan order. That cell is already covered or blocked, so the square would violate the constraints.

The position of the next square is therefore forced, but its size is not. Exploring every feasible size explores every possible completion of the current partial solution. Pruning a branch that already uses at least as many squares as a known complete solution cannot remove a strictly better result. Thus, the best solution returned has the minimum number of squares.

## Optional improvements

### Lower bound on additional squares

Let `R` be the number of remaining uncovered cells, and let `M` be the largest side length of any square that fits entirely within the currently uncovered region. Every additional square covers at most `M²` cells, so at least

```text
ceil(R / M²)
```

additional squares are required. Prune when:

```text
length(chosen) + ceil(R / M²) >= length(best)
```

Compute this only when `R > 0`. The value `M` must bound square sizes across the entire remaining region; using only the largest square at the first uncovered cell is not a valid bound.

### Connected components

Split the uncovered region into components connected through shared cell edges. A valid square cannot span separate components, so each component can be solved independently and their minimum counts added.

### Memoization

Encode the uncovered cells as a bitmask or another immutable key. If the same uncovered state was previously reached using fewer or the same number of selected squares, the new branch cannot improve on that earlier branch and may be skipped.

### Better initial solution

Use a greedy complete partition as the initial best solution instead of all `1 × 1` squares. This can improve pruning, but the greedy solution is only an upper bound, not a proof of optimality.

## Complexity and practical limits

The search can grow exponentially with the number of non-blocked cells. Branch-and-bound reduces the explored search tree but does not guarantee fast execution for large grids.

Without memoization, a straightforward implementation uses `O(N²)` working memory for cell state, selected squares, the best solution, and the recursion stack, provided grid state is updated and undone in place. Memoization requires additional memory proportional to the number of stored states.

If execution is stopped early, the best complete solution found is a valid partition, but it is not guaranteed to be optimal unless the remaining branches have been ruled out.
