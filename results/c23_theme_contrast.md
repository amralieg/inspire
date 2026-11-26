# c23 dark theme contrast (WCAG AA text needs 4.5:1)

## App (index.css .dark)

| text | bg #0e0b19 | surface #181f25 | bg-subtle #1f272d | panel #1a2129 |
|---|---|---|---|---|
| primary #F0F0F3 | 17.09 | 14.64 | 13.32 | 14.27 |
| secondary #A0A0AB | 7.51 | 6.43 | 5.85 | 6.27 |
| tertiary #9A9AA5 | 6.98 | 5.98 | 5.44 | 5.83 |

## Shell (palettes.json, all palettes except mono share these surfaces)

| text | bg | card | well | panel |
|---|---|---|---|---|
| ink #e7edf3 | 16.48 | 14.11 | 12.84 | 13.77 |
| muted #a6b2be | 9.01 | 7.72 | 7.02 | 7.52 |

Shell contrast.test.mjs (26 palette x theme checks, incl. chart/control 3:1) passes. Two chart lines brightened for the lighter well: jewel violet-line #6e4aff->#7b5bff, pop green-line #4c5df0->#5b6bf2.
