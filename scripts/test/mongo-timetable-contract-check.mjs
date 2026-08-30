/* Mongo-only timetable API contract check.
   Run: node scripts/test/mongo-timetable-contract-check.mjs */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const handler = require("../../api/timetable.js");

let failures = 0;
const check = (name, value) => {
  if (value) console.log(`  ok    ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
};

const snapshot = {
  "BS CY": {
    "2024": {
      A: { Friday: [{ name: "Web Prog", location: "C-307", time: "08:30-09:50" }] },
    },
  },
};
const { occupancy, count } = handler.buildCDRoomOccupancy(snapshot);
check("counts a generated C/D-room class", count === 1);
check("keeps its generated cohort", occupancy.Friday?.["C-307"]?.[0]?.dept === "BS CY");
check("keeps its generated batch and section", occupancy.Friday?.["C-307"]?.[0]?.batch === "2024" && occupancy.Friday?.["C-307"]?.[0]?.section === "A");
check("counts reference entries", handler.countEntries(snapshot) === 1);

process.exit(failures ? 1 : 0);
