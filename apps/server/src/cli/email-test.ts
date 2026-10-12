import { runEmailTest } from "@whistle/runtime";
await runEmailTest("STAFF").catch(() => {
  console.error(
    "Email configuration is invalid; no private details were logged.",
  );
  process.exitCode = 1;
});
