// Minimal WASI preview1 shim for the browser — just enough to run an arche compute+print `.wasm`.
//
// An arche wasm module is a WASI "command" (wasi-libc `_start` → the emitted `__main_argc_argv`). In a
// browser there are no real file descriptors, so we hand-implement the `wasi_snapshot_preview1` imports.
// For a compute + `fmt.print` program the only import that does real work is `fd_write` (wasi-libc
// `write(1,…)` ← arche `os.write` ← the `@arche_syscall` shim) — we read the iovecs out of wasm linear
// memory and append the bytes to `this.stdout`, which the page renders. Everything else is either the
// `_start` preamble (args / prestat enumeration) or an inert stub. Pure JS, no dependencies.
//
// The arche compute demos import exactly: args_get, args_sizes_get, fd_close, fd_fdstat_get,
// fd_prestat_get, fd_prestat_dir_name, fd_seek, fd_write, proc_exit. We provide those (plus a few
// harmless extras — unimported names are simply ignored) so later demos that touch a clock/rng work too.
(function (global) {
  const OK = 0, EBADF = 8, ENOSYS = 52; // WASI errno
  const FILETYPE_CHARACTER_DEVICE = 2;

  // proc_exit is signalled by unwinding the stack with this sentinel (caught in start()).
  class WasiExit { constructor(code) { this.code = code; } }

  class WasiShim {
    constructor(args) {
      this.args = args && args.length ? args : ["prog"];
      this.stdout = "";
      this.stderr = "";
      this.memory = null;      // set in start(), from the instance's exported memory
      this._dec = new TextDecoder();
      this._enc = new TextEncoder();
    }

    // memory can grow (its ArrayBuffer detaches), so recompute the views every call.
    _dv() { return new DataView(this.memory.buffer); }
    _u8() { return new Uint8Array(this.memory.buffer); }

    start(instance) {
      this.memory = instance.exports.memory;
      try {
        instance.exports._start();
      } catch (e) {
        if (e instanceof WasiExit) {
          if (e.code !== 0) throw new Error("wasm exited with non-zero code " + e.code);
          return; // normal `proc_exit(0)` / program return
        }
        throw e;
      }
    }

    get imports() {
      const self = this;
      const wasi = {
        fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
          const dv = self._dv(), u8 = self._u8();
          let total = 0, s = "";
          for (let i = 0; i < iovsLen; i++) {
            const p = iovsPtr + i * 8;
            const buf = dv.getUint32(p, true), len = dv.getUint32(p + 4, true);
            s += self._dec.decode(u8.subarray(buf, buf + len));
            total += len;
          }
          if (fd === 2) self.stderr += s; else self.stdout += s;
          dv.setUint32(nwrittenPtr, total, true);
          return OK;
        },
        fd_read() { return EBADF; },
        fd_close() { return OK; },
        fd_seek() { return ENOSYS; },
        // wasi-libc stats fd 0/1/2 at startup to pick buffering — report a character device so writes flow.
        fd_fdstat_get(fd, statPtr) {
          const dv = self._dv();
          dv.setUint8(statPtr, FILETYPE_CHARACTER_DEVICE); // fs_filetype
          dv.setUint16(statPtr + 2, 0, true);              // fs_flags
          dv.setBigUint64(statPtr + 8, 0xffffffffffffffffn, true);  // fs_rights_base
          dv.setBigUint64(statPtr + 16, 0xffffffffffffffffn, true); // fs_rights_inheriting
          return OK;
        },
        fd_fdstat_set_flags() { return OK; },
        // No preopened directories → EBADF ends wasi-libc's fd 3,4,… enumeration (else it spins).
        fd_prestat_get() { return EBADF; },
        fd_prestat_dir_name() { return EBADF; },
        path_open() { return ENOSYS; },
        args_sizes_get(argcPtr, bufSizePtr) {
          const dv = self._dv();
          let bufSize = 0;
          for (const a of self.args) bufSize += self._enc.encode(a).length + 1;
          dv.setUint32(argcPtr, self.args.length, true);
          dv.setUint32(bufSizePtr, bufSize, true);
          return OK;
        },
        args_get(argvPtr, argvBufPtr) {
          const dv = self._dv(), u8 = self._u8();
          let p = argvBufPtr;
          for (let i = 0; i < self.args.length; i++) {
            dv.setUint32(argvPtr + i * 4, p, true);
            for (const ch of self._enc.encode(self.args[i])) u8[p++] = ch;
            u8[p++] = 0;
          }
          return OK;
        },
        environ_sizes_get(cntPtr, bufSizePtr) {
          const dv = self._dv();
          dv.setUint32(cntPtr, 0, true);
          dv.setUint32(bufSizePtr, 0, true);
          return OK;
        },
        environ_get() { return OK; },
        clock_time_get(id, precision, timePtr) {
          self._dv().setBigUint64(timePtr, BigInt(Date.now()) * 1000000n, true); // ms → ns
          return OK;
        },
        clock_res_get(id, resPtr) { self._dv().setBigUint64(resPtr, 1000000n, true); return OK; },
        random_get(bufPtr, len) { globalThis.crypto.getRandomValues(self._u8().subarray(bufPtr, bufPtr + len)); return OK; },
        poll_oneoff() { return ENOSYS; },
        sched_yield() { return OK; },
        proc_exit(code) { throw new WasiExit(code); },
      };
      return { wasi_snapshot_preview1: wasi };
    }
  }

  global.WasiShim = WasiShim;
  if (typeof module !== "undefined" && module.exports) module.exports = { WasiShim }; // node test harness
})(typeof window !== "undefined" ? window : globalThis);
