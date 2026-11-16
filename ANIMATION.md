# After Hours animation format

A crossword can carry one pixel-art animation. It plays **once**, over the grid, when the solver has filled a chosen
percentage of the white squares. The canvas is N × N pixels and always stretches to fill the puzzle's grid, whatever
the crossword's own size. While it plays the solver cannot click or type; when it ends, their puzzle is exactly as
they left it.

An animation comes in two interchangeable forms:

- **An `.ahanim` file**: compact binary, and what the Animation Studio's **Export** writes. Use it for anything
  long or large. A one-minute 256 × 256 animation is about 47 million pixels and typically 1–3 MB as a file.
- **The JSON form** below: plain text you can write by hand, for small animations.

The Studio's **Import** reads both, and so does every tool in the MCP server. A puzzle does not hold the pixels:
it stores a small reference to the animation's `.ahanim` file (see [In a puzzle](#in-a-puzzle)).

## The JSON form

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
| `size` | N, a whole number from 2 to 256. Every frame is N rows of N characters. |
| `fps` | Frames per second, 1 to 30. Optional (defaults to 8). |
| `trigger` | Whole percent, 1 to 100: plays when this share of the white squares is filled. Optional (defaults to 50). |
| `background` | `"#rrggbb"` painted behind every frame, or `""` so the puzzle shows through empty pixels. Optional (defaults to `"#ffffff"`). |
| `palette` | Object mapping **one character** (`0-9`, `a-z`, `A-Z`; case-sensitive; up to 62) to a `"#rrggbb"` color. |
| `frames` | Array of frames, played in order. Each frame is an array of `size` strings, top row first; each string is `size` characters, left to right. A character is a palette key, or `.` for an empty pixel. |

## Length and limits

Length in seconds = `frames.length / fps`. For "a 3 second animation" at 8 fps, write 24 frames. To hold an image,
repeat the frame; repeated and barely-changed frames cost almost nothing in an `.ahanim` file.

| Limit | Value |
| --- | --- |
| Canvas | 2 × 2 to 256 × 256 |
| Frames | up to 3,600, and at most 120 million pixels in all (1,831 frames at 256 × 256: over a minute at 30 fps, 2½ minutes at 12 fps) |
| Colors | 255 in an `.ahanim` file, 62 in the JSON form |
| File | 64 MB |

## The `.ahanim` file

| Bytes | Contents |
| --- | --- |
| 0–3 | `AHAN` |
| 4 | Format version, `2` |
| 5–8 | Header length H, unsigned 32-bit little-endian |
| 9… | H bytes of UTF-8 JSON: `name`, `size`, `fps`, `trigger`, `background` as above, `palette` as an **array** of `"#rrggbb"` colors, and `frames` as the **number** of frames |
| rest | One raw DEFLATE stream holding every frame, one byte per pixel, rows top to bottom: `0` is an empty pixel, `n` is `palette[n - 1]`. The first frame is stored as is; every later frame is stored XORed with the frame before it, so pixels that don't change are zeros. |

`app/animation.ts` has the reader and writer (`decodeAnimation`, `encodeAnimation`), and `parseAnimation` /
`toText` convert to and from the JSON form. They run unchanged in the browser and in Node.
`animations/make-rugby-run.mjs` is an example of drawing a long animation in code and writing it as `.ahanim`.

## In a puzzle

`puzzle.animation` is a reference: `{ "version": 2, "id", "name", "size", "fps", "trigger", "frames", "bytes" }`,
where `id` names the `.ahanim` file (32 hex characters, from the SHA-256 of its bytes), `frames` is the frame count
and `bytes` the file size. The browser keeps the files in IndexedDB and the site keeps them beside the puzzle list
(`/api/animations`), so neither the puzzle list nor browser storage grows with the length of an animation.
An exported puzzle `.json` adds `"data"`: the whole file as base64, so the export is complete on its own.

Puzzles saved before `.ahanim` existed carry the JSON form directly in `puzzle.animation`; they still load and play.

## Video

**Export MP4** in the Studio renders the animation as a 1080 × 1920 H.264 video for TikTok, Reels and Shorts. The
canvas is scaled by a whole number so pixels stay crisp, and centered on the animation's background color.

## Tips for drawing

- In the JSON form, use one palette character per color and keep rows aligned; the JSON then reads like the picture.
- Motion reads best when consecutive frames change a little. Copy the previous frame and move a few pixels.
- End on the frame you want people to remember: the animation disappears right after the last frame.
- `trigger: 100` plays when the last square is filled, just before the completion message.

## MCP server

This repo ships an MCP server (no dependencies) for writing, checking and looking at animations from a tool-using
client:

```sh
node --experimental-strip-types mcp/animation.mjs
```

It is registered for Claude Code in `.mcp.json` as `afterhours-animation`, with these tools:

| Tool | What it does |
| --- | --- |
| `get_animation_format` | Returns this document. |
| `validate_animation` | Checks an animation and reports its size, frame count and length, or exactly what is wrong. |
| `render_animation` | Returns a PNG contact sheet of the frames so the agent can look at what it drew. |
| `save_animation` | Validates and writes an animation file: `.ahanim` (default `animations/<name>.ahanim`), or the JSON form when the path ends in `.json`. Also converts an existing file with `from`. |
| `read_animation` | Reads an animation from an `.ahanim` file, a JSON animation file or a puzzle file, and returns its JSON form (a summary when it is too large for that). |
| `attach_animation` | Saves an animation into a puzzle `.json` file (or removes it), ready to import or publish. |

Files are only read and written inside the folder the server was started from and this app's folder.
