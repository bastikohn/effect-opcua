# Demo Machine

`examples/demo-machine` contains a complete demo around one simulated industrial
cell, `DemoFillingCell`.

- [server](./server/README.md) describes the OPC UA simulation server and its
  address-space surface.
- [client](./client/README.md) describes the backend/HMI client SDK for
  submitting commands and reading telemetry.

This README describes the machine model itself: the physical concept, lifecycle,
commands, simulation scenarios, and non-goals shared by the server and client
examples.

## 1. Purpose

The demo machine is a simulated **two-axis automated filling and inspection cell**.

Its purpose is to demonstrate a realistic industrial PLC/HMI boundary:

```text
HMI / client
→ sends intent-level requests
→ observes machine state, process values, alarms, and counters

PLC / demo-server simulation
→ owns sequencing
→ owns interlocks
→ owns validation
→ owns command lifecycle
→ owns safety behavior
```

The HMI must **not** orchestrate the production cycle by sending low-level commands such as “move X,” “lower Z,” “start pump,” and “inspect.” Instead, it sends commands such as:

```text
Configure
Home
Start
Pause
Resume
Abort
Reset
ClearCompleted
```

Low-level single-axis or peripheral actions may exist only in **Manual** or **Maintenance** mode and are still PLC-validated intent requests.

This document describes only the **machine architecture and behavior**. It
intentionally does **not** define the OPC UA address-space or client
implementation shape.

---

## 2. Physical machine concept

The machine is a compact cell that processes one part at a time:

```text
DemoFillingCell
→ loads a container/carrier
→ clamps it
→ moves it to a filling station
→ lowers a filling head
→ doses liquid
→ raises the filling head
→ moves the part to inspection
→ evaluates fill quality
→ moves the part to unload
→ releases/removes the part
→ repeats until the configured batch is complete
```

The machine is **single-carrier and non-pipelined**. There is only one active part in the machine at a time.

There is no separate conveyor motor. Transport is handled entirely by the X axis.

---

## 3. Top-level hardware architecture

```text
DemoFillingCell
├─ Motion
│  ├─ XAxis
│  └─ ZAxis
├─ Filling
│  ├─ Tank
│  ├─ Pump
│  └─ NozzleValve
├─ PartHandling
│  └─ Clamp
├─ Inspection
├─ Safety
└─ OperatorFeedback
```

The demo-server simulates exactly **one** `DemoFillingCell` instance.

---

## 4. Motion system

### 4.1 Axis concept

The machine has two linear axes:

```text
XAxis
→ horizontal transport / indexing axis

ZAxis
→ vertical nozzle / process-head axis
```

Both axes should share the same reusable single-axis abstraction.

Each axis behaves like a simple deterministic servo axis:

```text
Axis
├─ State
│  ├─ Disabled
│  ├─ NotHomed
│  ├─ Standstill
│  ├─ Homing
│  ├─ Moving
│  ├─ Stopping
│  └─ Faulted
├─ ActualPositionMm
├─ TargetPositionMm
├─ ActualVelocityMmPerSecond
├─ CommandedVelocityMmPerSecond
├─ Homed
├─ Enabled
├─ PositiveLimitActive
├─ NegativeLimitActive
└─ FaultCode
```

The simulation should use **time-based deterministic motion**, not instant position jumps. It does not need full servo physics: no acceleration curves, jerk, torque, drive temperature, or following-error dynamics unless needed later.

### 4.2 X axis

The X axis moves a carrier between named stations.

```text
XAxis named positions
├─ Home   → 0 mm
├─ Load   → 100 mm
├─ Fill   → 300 mm
├─ Inspect→ 500 mm
└─ Unload → 700 mm
```

`Home` is a mechanical/reference position, not a production station.

The automatic production flow uses:

```text
Load → Fill → Inspect → Unload → Load
```

### 4.3 Z axis

The Z axis moves the filling nozzle/process head vertically.

```text
ZAxis named positions
├─ Home              → 0 mm
├─ SafeHeight        → 0 mm
├─ FillHeight        → -120 mm
└─ MaintenanceHeight → 40 mm
```

`Home` and `SafeHeight` may be the same physical position.

The key coordination rule is:

```text
X may move only when Z is at SafeHeight.
```

The production filling pump may only run when:

```text
safety OK
AND tank not empty
AND part clamped
AND X at Fill
AND Z at FillHeight
AND nozzle valve open
```

Service priming is a separate manual/maintenance behavior. It must not use the
production filling interlock and must never update part fill volume or production
counters.

---

## 5. Operating modes

The machine has three high-level operating modes:

```text
Automatic
Manual
Maintenance
```

### 5.1 Automatic mode

Automatic mode is the normal production mode.

The HMI may send only machine-level intent commands:

```text
Configure
Home
Start
Pause
Resume
Abort
Reset
ClearCompleted
```

The PLC owns the full production sequence.

### 5.2 Manual mode

Manual mode allows PLC-validated single actions, but no HMI-owned production sequence.

Allowed manual capabilities:

```text
Motion
→ Home X
→ Home Z
→ Move X to named station
→ Move Z to named height
→ Jog X positive / negative
→ Jog Z positive / negative

PartHandling
→ Open clamp
→ Close clamp

Filling
→ Prime pump
→ Stop pump
→ Open nozzle valve
→ Close nozzle valve

Inspection
→ Trigger inspection once

Recovery
→ Clear recoverable actuator fault
```

Every manual action is one intent request. The PLC accepts or rejects it based on interlocks.

Example:

```text
Allowed:
→ Move X to Fill

Rejected:
→ Move X to Fill while Z is not at SafeHeight
```

### 5.3 Maintenance mode

Maintenance mode is service-oriented and production-disabled.

Allowed maintenance capabilities:

```text
Filling service
→ Refill tank
→ Drain tank
→ Prime pump
→ Clean nozzle
→ Reset pump fault
→ Reset valve fault

Inspection service
→ Calibrate fill-level sensor
→ Simulate sensor check
→ Reset inspection fault

Motion service
→ Move Z to MaintenanceHeight
→ Home axes
→ Disable / enable axes
→ Clear recoverable axis faults

PartHandling service
→ Open clamp
→ Close clamp
→ Clear clamp fault
```

Not allowed in Maintenance mode:

```text
Start automatic production
Resume a paused batch
Count produced parts
Treat inspection results as production quality data
```

---

## 6. Mode-change rules

Mode changes are allowed only while the machine is not actively producing.

Allowed lifecycle states for ordinary mode changes:

```text
Idle
Ready
Complete
```

Recovery exception:

```text
Faulted or Aborted
→ Maintenance mode may be entered when:
  - all axes are stopped
  - pump is stopped
  - nozzle valve is closed
  - safety circuit is OK
→ this is only for service and recovery actions
→ leaving recovery requires Reset before Automatic production can become Ready
```

Rejected lifecycle states for mode changes:

```text
Running
Paused
SafetyStopped
Resetting
```

The HMI must not escape automatic sequencing by switching modes mid-cycle. To leave production, it must use lifecycle commands such as `Pause`, `Abort`, `Reset`, or `ClearCompleted`.

---

## 7. Machine lifecycle states

The machine has these coarse PLC-owned lifecycle states:

```text
Booting
Idle
Ready
Running
Paused
Complete
Aborted
Faulted
SafetyStopped
Resetting
```

Meaning:

```text
Booting
→ simulated PLC is initializing

Idle
→ machine is not running
→ configuration may or may not already exist
→ preconditions may or may not be satisfied

Ready
→ machine is configured, homed, safe, fault-free, and startable

Running
→ automatic production sequence is active

Paused
→ automatic sequence is paused at a PLC-defined safe pause point

Complete
→ configured batch completed successfully

Aborted
→ production was stopped by Abort before normal completion

Faulted
→ process or machine fault requires Reset

SafetyStopped
→ safety stop is latched
→ safety reset and machine Reset are required before recovery

Resetting
→ PLC is clearing recoverable state and returning to Idle or Ready
```

`Ready` is a real explicit PLC-owned state, not something the HMI computes itself.

Recommended readiness conditions:

```text
RunConfiguration valid
AND X axis homed
AND Z axis homed
AND safety OK
AND no active fault
AND tank not empty
AND machine mode is Automatic
```

---

## 8. Machine-level commands

The machine-level intent commands are:

```text
Configure
Home
Start
Pause
Resume
Abort
Reset
ClearCompleted
```

### 8.1 `Configure`

`Configure` accepts a `RunConfiguration`.

```ts
type RunConfiguration = {
  productName: string;
  targetFillVolumeMl: number;
  fillToleranceMl: number;
  pumpRateMlPerSecond: number;
  batchSize: number;
  xAxisSpeedMmPerSecond: number;
  zAxisSpeedMmPerSecond: number;
};
```

Semantics:

```text
productName
→ HMI/display metadata

targetFillVolumeMl
→ desired dose amount

fillToleranceMl
→ allowed inspection tolerance

pumpRateMlPerSecond
→ simulated process rate

batchSize
→ number of processed parts before Complete
→ rejected parts count toward this total

xAxisSpeedMmPerSecond
→ production movement speed for X

zAxisSpeedMmPerSecond
→ production movement speed for Z
```

`batchSize` is required. Automatic mode is batch-based, not endless/cyclic.
It is a processed-part target, not a good-part target:

```text
Complete when CompletedCount == batchSize
CompletedCount == GoodCount + RejectedCount
RemainingCount == batchSize - CompletedCount
```

`Configure` does not start motion. It validates and stores the active run
configuration and resets batch-local counters.

Allowed states:

```text
Idle
Ready
```

Rejected states:

```text
Running
Paused
Complete
Aborted
Faulted
SafetyStopped
Resetting
```

To run another batch after `Complete`, the HMI must first call
`ClearCompleted`.

### 8.2 `Home`

`Home` is a machine-level command.

The HMI must not sequence homing itself.

Recommended behavior:

```text
Home
→ allowed in Idle when safety is OK
→ PLC homes Z first, then X
→ Z ends at SafeHeight
→ X ends at Home
→ axes become Homed
→ machine becomes Ready if RunConfiguration is valid and all other preconditions are OK
```

`Configure` and `Home` are order-independent:

```text
Configure → Home → Ready
Home → Configure → Ready
```

### 8.3 `Start`

`Start` is accepted only from `Ready`.

It starts the automatic batch sequence.

Startup positioning:

```text
Start accepted
→ if X is not at Load, PLC first moves X to Load
→ this requires Z at SafeHeight
→ no part is loaded and no counters are updated during this positioning move
→ MachineState is Running and CyclePhase remains None during this move
→ CyclePhase becomes WaitingForLoad only after X is at Load
```

This keeps `Home` as a mechanical/reference position while making `Load` the
first production station.

### 8.4 `Pause`

`Pause` is request-based and controlled by the PLC.

It is not an arbitrary instant freeze.

Recommended behavior:

```text
Pause requested during Running
→ PLC records pause request
→ current unsafe/atomic phase finishes
→ machine moves to a safe paused condition
→ MachineState becomes Paused
→ cycle context is retained for Resume
```

Safe pause points:

```text
WaitingForLoad
After Clamping
After RaisingNozzle
After Inspecting
After Unclamping / WaitingForUnload
```

Unsafe phases that should complete before pausing:

```text
MovingToFill
LoweringNozzle
Filling
RaisingNozzle
MovingToInspect
MovingToUnload
ReturningToLoad
```

Example:

```text
Pause requested during Filling
→ finish current fill
→ close valve
→ stop pump
→ raise Z to SafeHeight
→ enter Paused
```

### 8.5 `Resume`

`Resume` continues from the retained automatic cycle context after `Paused`.

### 8.6 `Abort`

`Abort` performs a controlled immediate stop into `Aborted`.

Recommended behavior:

```text
Abort requested from Running or Paused
→ stop pump immediately
→ close nozzle valve
→ stop active axis motion with controlled deceleration
→ keep clamp in its current safe state
→ do not continue the current part
→ current part is aborted and not counted as good or rejected
→ MachineState becomes Aborted
```

Recovery happens via `Reset`.

### 8.7 `Reset`

`Reset` clears recoverable states such as:

```text
Faulted
Aborted
SafetyStopped after safety inputs are restored and safety reset is acknowledged
invalid transient state
```

The machine enters `Resetting` briefly and then returns to `Idle` or `Ready`,
depending on preconditions.

`Reset` does not perform maintenance actions by itself. If the physical/simulated
cause of a fault is still active, the machine remains or returns to `Faulted`.

### 8.8 `ClearCompleted`

`ClearCompleted` acknowledges `Complete` and returns the machine to `Idle` or `Ready`.

---

## 9. Automatic production cycle

The automatic cycle processes one part at a time.

```text
1. WaitingForLoad
2. Clamping
3. MovingToFill
4. LoweringNozzle
5. Filling
6. RaisingNozzle
7. MovingToInspect
8. Inspecting
9. MovingToUnload
10. Unclamping
11. WaitingForUnload
12. ReturningToLoad
```

The machine tracks both:

```text
MachineState
→ coarse lifecycle, for example Running or Paused

CyclePhase
→ detailed PLC-owned production phase
```

`CyclePhase` is read-only from the HMI perspective. It is for display, diagnostics, and tests.

Cycle phases:

```text
CyclePhase
├─ None
├─ WaitingForLoad
├─ Clamping
├─ MovingToFill
├─ LoweringNozzle
├─ Filling
├─ RaisingNozzle
├─ MovingToInspect
├─ Inspecting
├─ MovingToUnload
├─ Unclamping
├─ WaitingForUnload
└─ ReturningToLoad
```

The normal sequence:

```text
Start
→ if needed, move X to Load with Z at SafeHeight
→ enter WaitingForLoad

WaitingForLoad
→ simulated part appears automatically
→ clamp closes
→ X moves to Fill
→ Z moves to FillHeight
→ valve opens
→ pump fills to target volume
→ valve closes
→ Z moves to SafeHeight
→ X moves to Inspect
→ fill-level inspection runs
→ X moves to Unload
→ clamp opens
→ part disappears automatically
→ completion counters commit
→ X returns to Load
→ repeat until batchSize reached
→ Complete
```

---

## 10. Part handling

Part handling is automatic only. There are no manual simulation controls for “place part” or “remove part.”

```text
Load station
→ simulated part appears automatically when machine waits for load

Unload station
→ finished part disappears automatically when machine reaches unload
```

The machine includes a clamp actuator:

```text
Clamp
├─ Open
├─ Closed
├─ Moving
└─ Faulted
```

Clamp behavior:

```text
At Load
→ part appears
→ clamp closes before X moves

During Fill / Inspect
→ clamp must be closed

At Unload
→ clamp opens
→ part disappears automatically
```

---

## 11. Filling module

The filling module consists of:

```text
Filling
├─ Tank
├─ Pump
└─ NozzleValve
```

### 11.1 Tank

The tank is a finite simulated resource.

```text
CapacityMl: 10_000
LowLevelThresholdMl: 1_000
EmptyThresholdMl: 100
```

Behavior:

```text
Default scenario
→ tank starts full

LowTank scenario
→ tank starts near warning/empty threshold

Each filled part
→ tank level decreases by actual filled volume

TankLow threshold reached
→ warning becomes active

TankEmpty threshold reached
→ machine enters Faulted with TankEmpty

Maintenance mode
→ RefillTank restores level
→ DrainTank reduces level
```

### 11.2 Pump

Pump states:

```text
Pump
├─ Stopped
├─ Running
├─ Priming
└─ Faulted
```

Service priming behavior:

```text
Manual or Maintenance mode only
AND machine is not Running
AND safety OK
AND tank not empty
AND nozzle valve closed
→ pump enters Priming for a bounded simulated duration
→ no part fill volume changes
→ no tank volume changes unless a later service-drain model explicitly adds it
```

### 11.3 Nozzle valve

Valve states:

```text
NozzleValve
├─ Closed
├─ Open
├─ Moving
└─ Faulted
```

Filling behavior:

```text
X at Fill
→ Z at FillHeight
→ valve opens
→ pump runs until target volume is reached
→ valve closes
→ Z returns to SafeHeight
```

---

## 12. Inspection module

Inspection is focused on fill-level quality, not camera/image complexity.

```text
Inspection
├─ FillLevelMl
├─ FillLevelOk
├─ Result
│  ├─ NotInspected
│  ├─ Pass
│  └─ Fail
└─ RejectReason
   ├─ None
   ├─ Underfilled
   ├─ Overfilled
   └─ SensorFault
```

Behavior:

```text
X moves to Inspect
→ simulated fill-level sensor measures actual fill volume
→ PLC compares actual volume with:
   targetFillVolumeMl ± fillToleranceMl
→ result becomes Pass or Fail
→ reject reason is set if needed
→ result is staged on CurrentPart
```

No camera stream or image inspection is included for v1.

---

## 13. Safety module

The safety module includes:

```text
Safety
├─ EmergencyStop
│  └─ Released | Pressed
├─ GuardDoor
│  └─ Closed | Open
├─ SafetyCircuit
│  └─ Ok | Interrupted
├─ ResetRequired
│  └─ boolean
└─ StopReason
   └─ None | EmergencyStop | GuardDoorOpen
```

Safety behavior:

```text
Emergency stop pressed
→ machine enters SafetyStopped
→ axes stop
→ pump stops
→ valve closes
→ clamp remains in safe/current state
→ ResetRequired becomes true

Guard door opened
→ machine enters SafetyStopped
→ axes stop
→ pump stops
→ valve closes
→ ResetRequired becomes true

Safety inputs restored
→ EmergencyStop must be Released
→ GuardDoor must be Closed
→ machine remains SafetyStopped
→ ResetRequired remains true

Safety reset acknowledged
→ allowed only when E-stop is released and guard door is closed
→ clears ResetRequired
→ machine remains SafetyStopped until machine Reset is accepted

Machine Reset
→ allowed from SafetyStopped only after safety reset is acknowledged
→ machine enters Resetting, then Idle or Ready
```

Do not model light curtains, dual-channel safety diagnostics, safe torque off internals, or a safety PLC for v1.

---

## 14. Operator feedback

The machine has PLC-controlled operator feedback:

```text
OperatorFeedback
├─ StackLight
│  ├─ Red
│  ├─ Yellow
│  ├─ Green
│  └─ Blue
└─ Buzzer
   ├─ Off
   ├─ ShortPulse
   ├─ Intermittent
   └─ Continuous
```

Recommended meanings:

```text
Green
→ Running or Ready

Yellow
→ Idle, Paused, waiting for condition, or setup/manual activity

Red
→ Faulted, SafetyStopped, or Aborted

Blue
→ Maintenance mode

Buzzer ShortPulse
→ batch complete or operator notification

Buzzer Intermittent
→ warning or recoverable issue

Buzzer Continuous
→ safety stop or hard fault
```

The HMI observes these states but does not directly command them during normal operation.

---

## 15. Production counters and metrics

The machine tracks batch-local counters plus non-persistent lifetime counters.

```text
Production
├─ Batch
│  ├─ TargetCount
│  ├─ StartedCount
│  ├─ CompletedCount
│  ├─ GoodCount
│  ├─ RejectedCount
│  └─ RemainingCount
├─ CurrentPart
│  ├─ Index
│  ├─ FillVolumeMl
│  ├─ InspectionResult
│  └─ RejectReason
├─ Timing
│  ├─ LastCycleTimeMs
│  ├─ AverageCycleTimeMs
│  └─ BatchElapsedTimeMs
└─ Lifetime
   ├─ TotalCompletedCount
   ├─ TotalGoodCount
   └─ TotalRejectedCount
```

Rules:

```text
Batch counters
→ reset on Configure
→ not reset by Pause or Resume

CurrentPart
→ updated during the active cycle
→ inspection results are staged here before unload

StartedCount
→ increments when a part is loaded and clamping starts

CompletedCount, GoodCount, RejectedCount
→ committed only after the part reaches unload, clamp opens, and the part disappears
→ aborted current parts are not counted as completed, good, or rejected

RemainingCount
→ TargetCount - CompletedCount

Timing
→ useful for HMI dashboards and monitoring demos

Lifetime counters
→ in-memory only
→ reset when demo-server restarts
```

No persistence/database is needed.

---

## 16. Warnings, faults, and safety stops

The machine distinguishes three severities:

```text
Warnings
→ visible to HMI
→ production may continue
→ may prevent Ready/Start if still active

Faults
→ production cannot continue
→ machine enters Faulted
→ Reset required after cause is cleared

Safety stops
→ separate from normal faults
→ machine enters SafetyStopped
→ safety reset plus machine Reset required
```

### 16.1 Warnings

```text
Warnings
├─ TankLow
├─ FillLevelDrift
├─ InspectionRejectRateHigh
├─ MaintenanceRecommended
└─ CycleTimeHigh
```

### 16.2 Faults

```text
Faults
├─ MotionFault
│  ├─ XAxisNotHomed
│  ├─ ZAxisNotHomed
│  ├─ XAxisPositionError
│  └─ ZAxisPositionError
├─ PartHandlingFault
│  └─ ClampFailedToClose
├─ FillingFault
│  ├─ TankEmpty
│  ├─ PumpFault
│  └─ ValveFault
└─ InspectionFault
   └─ SensorFault
```

Faults should be deterministic, not random by default.

### 16.3 Safety stop reasons

Safety stops are not normal machine faults. They use the `SafetyStopped`
lifecycle state and the safety reset flow.

```text
SafetyStopReasons
├─ EmergencyStop
└─ GuardDoorOpen
```

---

## 17. Simulation scenarios

The active simulation scenario is selected at demo-server startup/config level, not through the normal HMI/machine interface.

Scenarios:

```text
Default
LowTank
ClampFault
InspectionRejects
SafetyStop
MotionFault
```

Behavior:

```text
Default
→ no unexpected faults
→ happy-path production works reliably

LowTank
→ tank starts low
→ TankLow warning appears first
→ TankEmpty fault occurs if production continues

ClampFault
→ clamp fails when the first part is loaded
→ machine enters Faulted

InspectionRejects
→ some parts are deterministically underfilled/overfilled
→ machine continues
→ counters show rejects

SafetyStop
→ E-stop or guard-door interruption occurs at a predictable cycle step

MotionFault
→ one axis fails to reach target at a predictable step
→ machine enters Faulted
```

The scenario is a simulation harness concern, not a normal machine command.

Example conceptual startup configuration:

```ts
startDemoOpcuaServer({
  port: 4334,
  scenario: "Default",
  simulationSpeed: 1,
});
```

---

## 18. Simulation timing

The simulation runs in real time by default, but supports startup-configurable acceleration.

```text
Demo / TUI / HMI showcase
→ simulationSpeed = 1

Integration tests
→ simulationSpeed = 10–50
```

The speed factor is not part of normal HMI/machine control.

---

## 19. Scope boundaries and explicit non-goals

Included:

```text
One DemoFillingCell
Two linear axes: X and Z
PLC-owned automatic sequence
Manual and Maintenance modes
RunConfiguration-based batch production
Automatic part simulation
Clamp, tank, pump, nozzle valve
Fill-level inspection
Safety stop behavior
Stack light and buzzer
Warnings, faults, deterministic scenarios
Production counters and timing metrics
```

Excluded for now:

```text
OPC-UA address-space/interface design
Multiple machine instances
Separate conveyor motor
Pipelined/multi-part production
Camera/image stream
Robot/capping/weighing station
Random fault injection by default
Persistent counters/database
Full servo physics
Detailed safety PLC internals
HMI-owned production sequencing
Manual part-place / part-remove simulation controls
```
