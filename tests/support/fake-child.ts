// A stubbed child_process.spawn for the claude-cli backend tests (never a real process, never a real model).
// Each spawned "child" answers from a script chosen by its argv; every call is recorded (argv, options, stdin).
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";

export interface ChildScript {
  /** Printed on stdout, then the child exits. */
  stdout?: string;
  /** Exit code (default 0). */
  code?: number | null;
  /** Milliseconds before the child answers. */
  delayMs?: number;
  /** Never answers; only a kill ends it. */
  hang?: boolean;
  /** The spawn fails: an "error" event with this code (e.g. "ENOENT"). */
  errorCode?: string;
}

export interface SpawnCall {
  command: string;
  args: string[];
  options: SpawnOptions;
  stdin: string;
  killed: boolean;
  startedAt: number;
  closedAt?: number;
}

export function stubSpawn(answer: (args: string[]) => ChildScript) {
  const calls: SpawnCall[] = [];
  let active = 0;
  let maxActive = 0;

  function spawn(command: string, args: readonly string[], options: SpawnOptions): ChildProcess {
    const call: SpawnCall = { command, args: [...args], options, stdin: "", killed: false, startedAt: Date.now() };
    calls.push(call);
    const script = answer(call.args);
    const child = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    let closed = false;
    active++;
    maxActive = Math.max(maxActive, active);

    const close = (code: number | null, signal: string | null) => {
      if (closed) return;
      closed = true;
      active--;
      call.closedAt = Date.now();
      child.emit("close", code, signal);
    };
    const start = () => {
      if (script.errorCode) {
        setImmediate(() => {
          if (closed) return;
          closed = true;
          active--;
          child.emit("error", Object.assign(new Error("spawn failed"), { code: script.errorCode }));
        });
        return;
      }
      if (script.hang) return;
      setTimeout(() => {
        if (closed) return;
        if (script.stdout) stdout.emit("data", Buffer.from(script.stdout, "utf8"));
        stderr.emit("data", Buffer.from("some diagnostics that must never be logged", "utf8"));
        close(script.code === undefined ? 0 : script.code, null);
      }, script.delayMs ?? 0);
    };

    Object.assign(child, {
      pid: 4242,
      stdout,
      stderr,
      stdin: {
        on() {
          return this;
        },
        write(s: string | Buffer) {
          call.stdin += String(s);
          return true;
        },
        end(s?: string | Buffer) {
          if (s) call.stdin += String(s);
          start();
        },
      },
      kill() {
        call.killed = true;
        setImmediate(() => close(null, "SIGKILL"));
        return true;
      },
    });
    return child as unknown as ChildProcess;
  }

  return {
    spawn,
    calls,
    get maxActive() {
      return maxActive;
    },
  };
}
