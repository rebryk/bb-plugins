import { describe, expect, it } from "vitest";
import {
  parseProcStat,
  parsePs,
  protection,
  toProcessInfos,
  type Proc,
} from "./processes";

const proc = (pid: number, ppid: number, cpuSeconds = 0): Proc => ({
  pid,
  ppid,
  name: `p${pid}`,
  command: `p${pid}`,
  cpuSeconds,
  memoryBytes: 0,
});

describe("parsePs", () => {
  const helper =
    "/Applications/Aside.app/Contents/Frameworks/Aside Framework.framework/Versions/1.0.928.1/Helpers/Aside Helper (Renderer).app/Contents/MacOS/Aside Helper (Renderer)";
  const stats = [
    "    1     0  12080  13:49.23 /sbin/launchd",
    " 9609 43332 566752  15:49.41 next-server (v16.3.8)",
    `11000 46605 201376   0:03.56 ${helper}`,
    " 1253   734      0   0:00.00 <defunct>",
    "",
  ].join("\n");
  const args = [
    "    1 /sbin/launchd",
    " 9609 next-server (v16.3.8) ",
    `11000 ${helper} --type=renderer ${"--flag ".repeat(100)}`,
    "",
  ].join("\n");

  it("names each process after its executable", () => {
    const procs = parsePs(stats, args);
    expect(procs.map((p) => p.name)).toEqual([
      "launchd",
      "next-server (v16.3.8)",
      "Aside Helper (Renderer)",
      "<defunct>",
    ]);
    expect(procs[1]).toEqual({
      pid: 9609,
      ppid: 43332,
      name: "next-server (v16.3.8)",
      command: "next-server (v16.3.8)",
      cpuSeconds: 15 * 60 + 49.41,
      memoryBytes: 566752 * 1024,
    });
  });

  it("cuts long command lines and falls back to the executable", () => {
    const procs = parsePs(stats, args);
    expect(procs[2].command).toHaveLength(200);
    expect(procs[2].command.startsWith(helper)).toBe(true);
    expect(procs[3].command).toBe("<defunct>");
  });
});

describe("parseProcStat", () => {
  const stat =
    "4242 (tmux: server (1)) S 1 4242 4242 0 -1 4194624 2306 0 0 0 150 50 0 0 20 0 1 0 12345 10805248 1200 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 3 0 0 0 0 0";

  it("reads a name with spaces and parentheses", () => {
    expect(parseProcStat(stat, "tmux\0new-session\0-d\0", 4096)).toEqual({
      pid: 4242,
      ppid: 1,
      name: "tmux: server (1)",
      command: "tmux new-session -d",
      cpuSeconds: 2,
      memoryBytes: 1200 * 4096,
    });
  });

  it("uses the name for kernel threads without a command line", () => {
    const kthread =
      "2 (kthreadd) S 0 0 0 0 -1 2129984 0 0 0 0 0 3 0 0 20 0 1 0 2 0 0 18446744073709551615";
    expect(parseProcStat(kthread, "", 4096)?.command).toBe("kthreadd");
  });

  it("returns null for text it can't read", () => {
    expect(parseProcStat("", "", 4096)).toBeNull();
  });
});

describe("protection", () => {
  // launchd 1 → app 50 → {helper 51, bb 60 → {server 70, daemon 80 → agent 81}};
  // another app 90 under launchd.
  const procs = [
    proc(1, 0),
    proc(50, 1),
    proc(51, 50),
    proc(60, 50),
    proc(70, 60),
    proc(80, 60),
    proc(81, 80),
    proc(90, 1),
  ];

  it("guards the first process and all of BB, but not its agents", () => {
    const guard = protection(procs, 70);
    expect([1, 50, 51, 60, 70, 80, 81, 90].map(guard)).toEqual([
      "System process",
      "Part of BB",
      "Part of BB",
      "Part of BB",
      "Part of BB",
      "Part of BB",
      null,
      null,
    ]);
  });

  it("stops at a loop in the parents", () => {
    const guard = protection([proc(5, 6), proc(6, 5)], 5);
    expect(guard(6)).toBe("Part of BB");
  });
});

describe("toProcessInfos", () => {
  it("gives each process its share of one core since the last reading", () => {
    const before = { at: 1000, procs: [proc(10, 1, 5), proc(11, 1, 1), proc(12, 1, 9)] };
    const after = {
      at: 3000,
      procs: [proc(10, 1, 8), proc(11, 1, 1.5), proc(12, 1, 3), proc(13, 1, 0.5)],
    };
    const cpu = toProcessInfos(before, after, 999).map((p) => [p.pid, p.cpuPercent]);
    // 3 s on 2 s is 150%; a reused pid gives 0; a new process counts all its time.
    expect(cpu).toEqual([
      [10, 150],
      [11, 25],
      [12, 0],
      [13, 25],
    ]);
  });

  it("marks this process and its parents as protected", () => {
    const reading = { at: 0, procs: [proc(1, 0), proc(20, 1), proc(21, 20), proc(22, 1)] };
    const infos = toProcessInfos(reading, { ...reading, at: 1000 }, 21);
    expect(infos.map((p) => p.protected)).toEqual([true, true, true, false]);
  });
});
