Build a well completion schematic app (oilfield well diagram).

A three-part panel shell: a **left vertical tool rail** of icon buttons (add well, header,
schematic, completions, perforations, display, JSON); a central **well-schematic** panel that
draws casing strings, open-hole bit sections, cement, a tubing string, and perforation
intervals from seeded variables (depth increases downward, radial units inches); and right-side
data tables. Seed `well`, `casings`, `holes`, `cement`, `tubing`, `perforations`, `completions`.
Light theme, deep-teal accent.

Components: vtoolbar + iconbutton · wellschematic (reads seeded vars) · grid tables.