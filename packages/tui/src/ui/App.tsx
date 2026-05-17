import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";

import type { TuiRuntime, TuiState } from "../runtime/index.js";

export type AppProps = {
  readonly runtime: TuiRuntime;
};

export const App = ({ runtime }: AppProps) => {
  const { exit } = useApp();
  const [state, setState] = useState<TuiState>(runtime.getState());
  const [writeMode, setWriteMode] = useState(false);
  const [input, setInput] = useState("");

  useEffect(() => runtime.subscribe(setState), [runtime]);

  const selectedIndex = useMemo(
    () =>
      Math.max(
        0,
        state.tree.entries.findIndex(
          (entry) => entry.entryId === state.tree.selectedEntryId,
        ),
      ),
    [state.tree.entries, state.tree.selectedEntryId],
  );

  useInput((value, key) => {
    if (writeMode) {
      if (key.return) {
        const parsed = parseWriteInput(input);
        setWriteMode(false);
        setInput("");
        void runtime.writeSelected(parsed).catch((error) => {
          process.stderr.write(`${String(error)}\n`);
        });
        return;
      }
      if (key.escape) {
        setWriteMode(false);
        setInput("");
        return;
      }
      if (key.backspace || key.delete) {
        setInput((current) => current.slice(0, -1));
        return;
      }
      setInput((current) => current + value);
      return;
    }

    if (value === "q" || (key.ctrl && value === "c")) {
      void runtime.dispose().finally(exit);
      return;
    }
    if (key.upArrow) {
      const next = state.tree.entries[Math.max(0, selectedIndex - 1)];
      if (next) void runtime.selectNode(next.entryId);
      return;
    }
    if (key.downArrow) {
      const next =
        state.tree.entries[
          Math.min(state.tree.entries.length - 1, selectedIndex + 1)
        ];
      if (next) void runtime.selectNode(next.entryId);
      return;
    }
    const selected = state.tree.entries[selectedIndex];
    if (!selected) return;
    if (key.return) {
      if (selected.expanded) void runtime.collapseNode(selected.entryId);
      else void runtime.expandNode(selected.entryId);
      return;
    }
    if (value === "r") void runtime.refreshNode(selected.entryId);
    if (value === "m") {
      if (state.monitors.desired.has(selected.nodeId)) {
        void runtime.unmonitorSelected();
      } else {
        void runtime.monitorSelected();
      }
    }
    if (value === "w") {
      if (state.writesEnabled) setWriteMode(true);
      else
        process.stderr.write("Writes disabled; restart with --enable-writes\n");
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" paddingX={1}>
        <Text>
          {state.connection} | Monitored: {state.monitors.desired.size} |
          Writes: {state.writesEnabled ? "enabled" : "disabled"}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Box width="45%" flexDirection="column" paddingX={1}>
          {state.tree.entries.slice(0, 30).map((entry) => (
            <Text
              key={entry.entryId}
              color={entry.repeated ? "yellow" : undefined}
            >
              {entry.entryId === state.tree.selectedEntryId ? ">" : " "}{" "}
              {"  ".repeat(Math.max(0, entry.pathNodeIds.length - 1))}
              {entry.nodeClass === "Variable"
                ? "v"
                : entry.expanded
                  ? "-"
                  : "+"}{" "}
              {entry.label}
            </Text>
          ))}
        </Box>
        <Box width="30%" flexDirection="column" paddingX={1}>
          <Text bold>Selected</Text>
          <Text>{state.selectedNode?.entry?.label ?? ""}</Text>
          <Text>{state.selectedNode?.entry?.nodeId ?? ""}</Text>
          <Text>{state.selectedNode?.entry?.nodeClass ?? ""}</Text>
          <Text>
            {state.selectedNode?.sample?._tag === "Value"
              ? formatValue(state.selectedNode.sample.value)
              : state.selectedNode?.sample?._tag}
          </Text>
          <Text>{state.selectedNode?.sample?.status.text ?? ""}</Text>
          {writeMode ? <Text color="cyan">write: {input}</Text> : null}
        </Box>
        <Box width="25%" flexDirection="column" paddingX={1}>
          <Text bold>Monitor</Text>
          {Array.from(state.monitors.latest).map(([nodeId, sample]) => (
            <Text key={nodeId}>
              {nodeId.split(".").at(-1)}{" "}
              {sample._tag === "Value"
                ? formatValue(sample.value)
                : sample._tag}
            </Text>
          ))}
          <Text bold>Log</Text>
          {state.eventLog.slice(-8).map((event, index) => (
            <Text key={`${event.time}-${index}`}>
              {event.time} {event.message}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

const formatValue = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);

const parseWriteInput = (input: string): unknown => {
  if (input === "true") return true;
  if (input === "false") return false;
  const number = Number(input);
  if (input.trim() !== "" && Number.isFinite(number)) return number;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
};
