# After Hours Crossword

An original crossword solver and creator, styled after the supplied New Yorker reference: a white newspaper layout, black grid, pale-blue selections, and serif clue columns. Includes the 7×7 sample **Twenty-something**, aimed at players in their early twenties. Independent project; not affiliated with The New York Times or The New Yorker.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:3000. `npm run build` produces a deployable `dist/` folder; `npm start` serves an existing build. There is no backend or account requirement.

## Create a crossword

1. Click **Create a crossword**. Enter a title and optional byline.
2. Enter one `ANSWER | clue` per line, then choose **Generate crossword**. Spaces, apostrophes, and hyphens in answers are removed.
3. Review the generated grid. Any answers that could not be connected are listed explicitly; add bridging words or revise the list to include them.
4. In **Edit grid & clues**, type answer letters, toggle black squares, and write clues. Use **Letters** or **Blocks** mode; optional symmetry mirrors block edits. Arrow keys move, Space switches typing direction, Tab changes entry, and `.` toggles a block. The selected-square input supports touch editing and rebus answers.
5. Follow the validation checklist, then click **Save & play**. Incomplete drafts can be saved to **My puzzles** too.

For a classic fully crossed grid, remix the sample or start a blank 5×5 through 21×21 grid. The word-list generator creates freeform connected crosswords; it does not invent dictionary fill for every empty crossing. Automatic numbering and shared answer letters update as you edit.

Drafts autosave in this browser. **My puzzles** supports play, edit, export, and confirmed deletion. **Export JSON** creates a backup you can send to someone else; **Import puzzle** adds a copy to their library. Exports include the solutions. Each puzzle version has separate solving progress; changing answers or clues starts fresh progress. Titles/bylines can change without resetting a solve.

## Solving features

- Across/Down clue lists, selected word and crossing clue highlighting
- Tab/Shift+Tab and Enter/Shift+Enter for next/previous unfinished clue (fully filled clues are skipped)
- Space to switch direction; arrows to switch axis and move
- Home/End to jump within a word; Backspace/Delete to erase
- Ctrl/Cmd+Z to undo; Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y to redo
- `+` toggles pencil; Insert opens rebus entry; Escape leaves grid keyboard mode
- Check toggle that marks wrong letters red and right letters green as you type, until you turn it off; reveal a square, word, or puzzle
- A filled-in grid tells you whether it's correct
- Optional skip-filled-squares behavior; pencil mode; rebus input
- Timer, pause/resume, local progress persistence, completion and share result
- Touch keyboard, responsive layout, printable blank puzzle, reset confirmation

Shortcuts operate while the grid has focus. Press Escape, then Tab to navigate toolbar controls. This sample contains no rebus answers. Checks/reveals mark a solve assisted. Browser storage is device-local; no cross-device sync. Font loading is optional, with local fallback fonts.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

Puzzle checks cover minimum entry length, clue completeness, unique answers, every white square having two entries, connectivity, and rotational symmetry. DOM integration checks cover typing, clue navigation, direction changes, undo/redo, checks, erasing, pencil, rebus dialog, pause/resume, persistence, reveal/completion, and reset. Browser visual QA could not run in the authoring sandbox because browser process/network socket creation was blocked.

Generator tests cover answer/clue preservation, unplaceable words, custom sizes, JSON validation, rebus cells, and progress isolation. A second DOM integration suite verifies generation, validation, saving, custom-size solving and completion, library editing, block undo, and deletion.

No subscriptions, licensed archives, accounts, cloud sync, or daily publishing service are included. All custom puzzle management happens locally in the browser.
