# After Hours animation format

A crossword can carry one pixel-art animation. It plays **once**, over the grid, when the solver has filled a chosen
percentage of the white squares. The canvas is N × N pixels and always stretches to fill the puzzle's grid, whatever
the crossword's own size. While it plays the solver cannot click or type; when it ends, their puzzle is exactly as
they left it.

An animation is one JSON object. It is stored inside a puzzle as `puzzle.animation`, or on its own as a `.json` file
(the Animation Studio's **Export JSON** / **Import JSON**).

```json
{
  "version": 1,
  "name": "Blinking heart",
  "size": 8,
  "fps": 2,
  "trigger": 50,
  "background": "#ffffff",
  "palette": { "r": "#e0245e", "p": "#f7a8c0" },
  "frames": [
    [
      "........",
      ".rr..rr.",
      "rrrrrrrr",
      "rrrrrrrr",
      ".rrrrrr.",
      "..rrrr..",
      "...rr...",
      "........"
    ],
    [
      "........",
      ".pp..pp.",
      "pprrrrpp",
      "prrrrrrp",
      ".prrrrp.",
      "..prrp..",
      "...pp...",
      "........"
    ]
  ]
}
```

## Fields

| Field | Rules |
| --- | --- |
| `version` | Always `1`. |
| `name` | Text, up to 60 characters. Optional (defaults to `"Animation"`). |
| `size` | N, a whole number from 2 to 32. Every frame is N rows of N characters. |
| `fps` | Frames per second, 1 to 30. Optional (defaults to 8). |
| `trigger` | Whole percent, 1 to 100: plays when this share of the white squares is filled. Optional (defaults to 50). |
| `background` | `"#rrggbb"` painted behind every frame, or `""` so the puzzle shows through empty pixels. Optional (defaults to `"#ffffff"`). |
| `palette` | Object mapping **one character** (`0-9`, `a-z`, `A-Z`; case-sensitive; up to 62) to a `"#rrggbb"` color. |
| `frames` | Array of frames, played in order. Each frame is an array of `size` strings, top row first; each string is `size` characters, left to right. A character is a palette key, or `.` for an empty pixel. |

## Length

Length in seconds = `frames.length / fps`. For "a 3 second animation" at 8 fps, write 24 frames. To hold an image,
repeat the frame. Limits: at most 300 frames, and `size × size × frames ≤ 150,000` (so 32 × 32 allows 146 frames,
16 × 16 allows 300).

## Tips for drawing

- Use one palette character per color and keep rows aligned; the JSON then reads like the picture.
- Motion reads best when consecutive frames change a little. Copy the previous frame and move a few pixels.
- End on the frame you want people to remember: the animation disappears right after the last frame.
- `trigger: 100` plays when the last square is filled, just before the completion message.

## Working with an AI agent

The format above is all an agent needs: ask for "an 8 × 8 animation of a blinking heart, 3 seconds" and import the
JSON in the Animation Studio. For tighter loops, this repo ships an MCP server (no dependencies):

```sh
node --experimental-strip-types mcp/animation.mjs
```

It is registered for Claude Code in `.mcp.json` as `afterhours-animation`, with these tools:

| Tool | What it does |
| --- | --- |
| `get_animation_format` | Returns this document. |
| `validate_animation` | Checks an animation and reports its size, frame count and length, or exactly what is wrong. |
| `render_animation` | Returns a PNG contact sheet of the frames so the agent can look at what it drew. |
| `save_animation` | Validates and writes an animation `.json` file (default `animations/<name>.json`). |
| `read_animation` | Reads an animation from an animation file or from a puzzle file. |
| `attach_animation` | Saves an animation into a puzzle `.json` file (or removes it), ready to import or publish. |

Files are only read and written inside the folder the server was started from and this app's folder.
