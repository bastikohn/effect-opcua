import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";

import type { TuiRuntime, TuiState } from "../runtime/index.js";

export type AppProps = {
  readonly runtime: TuiRuntime;
};

type ActivePane = "tree" | "value";

export const App = ({ runtime }: AppProps) => {
  const { exit } = useApp();
  const [state, setState] = useState<TuiState>(runtime.getState());
  const [writeMode, setWriteMode] = useState(false);
  const [input, setInput] = useState("");
  const [activePane, setActivePane] = useState<ActivePane>("tree");
  const [valueScroll, setValueScroll] = useState(0);
  const rows = useTerminalRows();

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
  const contentRows = Math.max(1, rows - 3);
  const treeStartIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(contentRows / 2),
      state.tree.entries.length - contentRows,
    ),
  );
  const visibleTreeEntries = state.tree.entries.slice(
    treeStartIndex,
    treeStartIndex + contentRows,
  );
  const monitorEntries = Array.from(state.monitors.latest);
  const monitorRows = Math.min(
    monitorEntries.length,
    Math.max(1, Math.floor((contentRows - 2) / 2)),
  );
  const logRows = Math.max(0, contentRows - monitorRows - 2);
  const visibleLogEvents = logRows > 0 ? state.eventLog.slice(-logRows) : [];
  const selectedValueRows = Math.max(1, contentRows - (writeMode ? 6 : 5));
  const selectedValueLines = formatValueLines(
    state.selectedNode?.sample?._tag === "Value"
      ? state.selectedNode.sample.value
      : state.selectedNode?.sample?._tag,
  );
  const maxValueScroll = Math.max(
    0,
    selectedValueLines.length - selectedValueRows,
  );
  const visibleValueLines = selectedValueLines.slice(
    Math.min(valueScroll, maxValueScroll),
    Math.min(valueScroll, maxValueScroll) + selectedValueRows,
  );

  useEffect(() => {
    setValueScroll(0);
  }, [state.tree.selectedEntryId, state.selectedNode?.sample]);

  useEffect(() => {
    setValueScroll((current) => Math.min(current, maxValueScroll));
  }, [maxValueScroll]);

  const selectByOffset = (offset: number) => {
    const nextIndex = Math.max(
      0,
      Math.min(state.tree.entries.length - 1, selectedIndex + offset),
    );
    const next = state.tree.entries[nextIndex];
    if (next) void runtime.selectNode(next.entryId);
  };

  const scrollValue = (offset: number) => {
    setValueScroll((current) =>
      Math.max(0, Math.min(maxValueScroll, current + offset)),
    );
  };

  useInput((value, key) => {
    if (writeMode) {
      if (key.return) {
        const parsed = parseWriteInput(input);
        setWriteMode(false);
        setInput("");
        void runtime.writeSelected(parsed).catch((error) => {
          runtime.reportError(String(error));
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
    if (key.tab) {
      setActivePane((current) => (current === "tree" ? "value" : "tree"));
      return;
    }
    if (key.pageUp) {
      if (activePane === "value") scrollValue(-selectedValueRows);
      else selectByOffset(-contentRows);
      return;
    }
    if (key.pageDown) {
      if (activePane === "value") scrollValue(selectedValueRows);
      else selectByOffset(contentRows);
      return;
    }
    if (key.upArrow || value === "k") {
      if (activePane === "value") scrollValue(-1);
      else selectByOffset(-1);
      return;
    }
    if (key.downArrow || value === "j") {
      if (activePane === "value") scrollValue(1);
      else selectByOffset(1);
      return;
    }
    if (value === "g") {
      if (activePane === "value") setValueScroll(0);
      else {
        const first = state.tree.entries[0];
        if (first) void runtime.selectNode(first.entryId);
      }
      return;
    }
    if (value === "G") {
      if (activePane === "value") setValueScroll(maxValueScroll);
      else {
        const last = state.tree.entries.at(-1);
        if (last) void runtime.selectNode(last.entryId);
      }
      return;
    }
    const selected = state.tree.entries[selectedIndex];
    if (!selected) return;
    if (key.return || key.rightArrow || value === "l") {
      if (selected.expanded) void runtime.collapseNode(selected.entryId);
      else void runtime.expandNode(selected.entryId);
      return;
    }
    if (key.leftArrow || value === "h") {
      if (selected.expanded) {
        void runtime.collapseNode(selected.entryId);
      } else if (selected.parentEntryId) {
        void runtime.selectNode(selected.parentEntryId);
      }
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
      else runtime.reportError("Writes disabled; restart with --enable-writes");
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" paddingX={1}>
        <Text wrap="truncate-end">
          {state.connection} | Monitored: {state.monitors.desired.size} |
          Writes: {state.writesEnabled ? "enabled" : "disabled"}
        </Text>
      </Box>
      <Box height={contentRows} overflow="hidden">
        <Box
          width="45%"
          height={contentRows}
          overflow="hidden"
          flexDirection="column"
          paddingX={1}
        >
          {visibleTreeEntries.map((entry) => (
            <Text
              key={entry.entryId}
              color={
                activePane === "tree" &&
                entry.entryId === state.tree.selectedEntryId
                  ? "cyan"
                  : entry.repeated
                    ? "yellow"
                    : undefined
              }
              wrap="truncate-end"
            >
              {entry.entryId === state.tree.selectedEntryId ? ">" : " "}{" "}
              {"  ".repeat(Math.max(0, entry.pathNodeIds.length - 1))}
              {entry.nodeClass === "Variable"
                ? "v"
                : entry.expanded
                  ? "-"
                  : "+"}{" "}
              {oneLine(entry.label)}
            </Text>
          ))}
        </Box>
        <Box
          width="30%"
          height={contentRows}
          overflow="hidden"
          flexDirection="column"
          paddingX={1}
        >
          <Text
            bold
            color={activePane === "value" ? "cyan" : undefined}
            wrap="truncate-end"
          >
            Selected
            {maxValueScroll > 0
              ? ` ${Math.min(valueScroll, maxValueScroll) + 1}/${selectedValueLines.length}`
              : ""}
          </Text>
          <Text wrap="truncate-end">
            {oneLine(state.selectedNode?.entry?.label)}
          </Text>
          <Text wrap="truncate-end">
            {oneLine(state.selectedNode?.entry?.nodeId)}
          </Text>
          <Text wrap="truncate-end">
            {oneLine(state.selectedNode?.entry?.nodeClass)}
          </Text>
          {visibleValueLines.map((line, index) => (
            <Text key={index} wrap="truncate-end">
              {line}
            </Text>
          ))}
          <Text wrap="truncate-end">
            {oneLine(state.selectedNode?.sample?.status.text)}
          </Text>
          {writeMode ? (
            <Text color="cyan" wrap="truncate-end">
              write: {oneLine(input)}
            </Text>
          ) : null}
        </Box>
        <Box
          width="25%"
          height={contentRows}
          overflow="hidden"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold wrap="truncate-end">
            Monitor
          </Text>
          {monitorEntries.slice(-monitorRows).map(([nodeId, sample]) => (
            <Text key={nodeId} wrap="truncate-end">
              {oneLine(nodeId.split(".").at(-1))}{" "}
              {sample._tag === "Value"
                ? formatCompactValue(sample.value)
                : sample._tag}
            </Text>
          ))}
          <Text bold wrap="truncate-end">
            Log
          </Text>
          {visibleLogEvents.map((event, index) => (
            <Text key={`${event.time}-${index}`} wrap="truncate-end">
              {event.time} {oneLine(event.message)}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

const useTerminalRows = () => {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows ?? process.stdout.rows ?? 24);

  useEffect(() => {
    const update = () => setRows(stdout.rows ?? process.stdout.rows ?? 24);
    update();
    stdout.on("resize", update);
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);

  return rows;
};

const oneLine = (value: unknown) =>
  String(value ?? "")
    .replaceAll(/\s+/g, " ")
    .trim();

const formatCompactValue = (value: unknown) =>
  oneLine(typeof value === "string" ? value : JSON.stringify(value));

const formatValueLines = (value: unknown) => {
  const text = formatPrettyValue(value);
  return text.split(/\r?\n/).map((line) => line.trimEnd());
};

const formatPrettyValue = (value: unknown) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

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
