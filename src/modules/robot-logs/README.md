# Robot logs

**Step 1 of 5 built.** After a match, open the robot's log and see where
the battery's energy went. So far the page opens a log and says what's in
it; the power summary comes once the programming team answers the
questions below.

## What works so far

- **Open a log** (on a laptop) picks a `.wpilog` file and reads it in the
  browser. Nothing is uploaded or saved.
- The page shows the match (from the file name), how long the log is, and
  every entry in it with its type and how many values it has. **Find an
  entry** narrows the list.
- A log copied while the robot is still writing it is cut off at the end.
  The page reads everything before that point and says so.
- A `.hoot` file gets a message saying to convert it with CTRE's tools
  first.

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module. It's in the Competition menu. |
| `wpilog.ts` | Reads a `.wpilog` file: its header, entries and every value. No npm package. |
| `data.ts` | Sums a log up for the page, and reads the match from the file name. |
| `data.test.ts` | Tests for both, with tiny made-up logs built inside the test. |
| `RobotLogsPage.tsx` | The page. |

## How the file is read

`wpilog.ts` follows WPILib's
[Data Log File Format Specification, version 1.0](https://github.com/wpilibsuite/allwpilib/blob/main/datalog/doc/datalog.adoc):
a header (`WPILOG`, a version, extra header text), then records. Entry id 0
is for control records (Start, Finish, Set metadata); every other record is
one timestamped value. It reads `boolean`, `int64`, `float`, `double`,
`string`, `json` and their arrays. Other types, like `struct:Pose2d`, are
kept as raw bytes, since they need their schema to read.

The match comes from the file name. WPILib's DataLogManager names a log
`FRC_yyyyMMdd_HHmmss_{event}_{match}.wpilog` once the field (FMS) is
connected, like `FRC_20260313_153000_ILCH_Q12.wpilog`, where the letter is
P (practice), Q (qualification), E (playoff) or T. Newer WPILib starts the
name with `WPILIB_` instead of `FRC_`. A log with no field connected has no
match in its name.

## Questions for the programming team

These need answering before step 2.

- **What does the robot log?** WPILib's DataLog (`.wpilog`), AdvantageKit
  (also `.wpilog`), or CTRE's Phoenix 6 signal logs (`.hoot`)? Is it on the
  roboRIO or a USB stick? `.hoot` files need converting with CTRE's tools
  before anything else can read them, so `.wpilog` is much easier.
- **What are the names in the log** for:
  - each motor's supply current and supply voltage;
  - each subsystem's state (IDLE, SCORING and so on);
  - enabled and auto? With `DriverStation.startDataLog()` these are
    `DS:enabled` and `DS:autonomous`.
- **Can we have one real match log** to build against? Don't commit a big
  one: a trimmed copy is enough for tests. Opening it on this page lists
  every entry name, which answers the question above.
- **Where did the power analysis page come from?** If it's from an
  existing script, copy its maths, so the numbers match.

## Next steps

One pull request each.

1. ~~Read a log in the browser.~~ Done.
2. **The power summary:** the five numbers (enabled time, energy, lowest
   voltage, sags, peak draw), the settings, and the Summary tab. A
   `robot.ts`, like Scouting's `season.ts`, says which motors make up each
   subsystem and where each one's state is logged. Every sum is a plain
   function in `data.ts`, with tests.
3. **Timeline, Sags and Motors tabs**, drawn with SVG.
4. **Keep each match's numbers** in a table (a migration and permission
   tests, approved by a mentor), shown side by side with the battery used
   in each match, from the Batteries module.
5. **Stretch:** a program on the pit laptop pulls each log off the roboRIO
   and sends the summary in. Mentor-led.

Charts: no new packages, and no new colours. A bar chart sorted biggest
first, in one colour, reads better on a phone than a nine-colour pie.
