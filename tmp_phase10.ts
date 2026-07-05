
import { handleUserMessage } from "./src/agent/roogle.ts";
(async () => {
  console.log("=== SEND TOKENS TEST ===");
  let res = await handleUserMessage({role:"user", content:"Send 2 sol to @obahakim"});
  console.log("Message:", res.message);
  console.log("Tool:", res.toolCalls ? res.toolCalls.map(t=>t.name) : []);
  console.log("Confirm:", res.requiresConfirmation);
  console.log("");
  console.log("=== CAPABILITIES TEST ===");
  res = await handleUserMessage({role:"user", content:"what can you do on Unicity?"});
  console.log("Message:", res.message);
})();
