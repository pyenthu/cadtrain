Build a project roadmap / Gantt app.

A level-1 heading and a small muted subtitle, then a **Gantt timeline** that reads a
`tasks` variable (axis in weeks, bars coloured by status), and a **task table** below it
showing id, label, lane, start, end, status. Seed `tasks` as a list of task records
(fields: id, label, lane, start, end, status, details). Light theme, blue accent.

Components: heading · text · gantt (rowsVar → vars.tasks) · grid (source readVar tasks).