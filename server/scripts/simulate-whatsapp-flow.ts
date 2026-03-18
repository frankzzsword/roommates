async function main() {
  const [{ initializeDatabase }, { processInboundMessage }, taskService, { db }, { config }] =
    await Promise.all([
      import("../src/db/init.js"),
      import("../src/services/message-service.js"),
      import("../src/services/task-service.js"),
      import("../src/db/client.js"),
      import("../src/config.js")
    ]);

  initializeDatabase();

  const assignmentsBefore = taskService.listAssignments();
  const varunAssignment = assignmentsBefore.find(
    (assignment) => assignment.roommateName === "Varun" && assignment.status === "pending"
  );
  const mayssaAssignment = assignmentsBefore.find(
    (assignment) => assignment.roommateName === "Mayssa" && assignment.status === "pending"
  );
  const noahAssignment = assignmentsBefore.find(
    (assignment) => assignment.roommateName === "Noah" && assignment.status === "pending"
  );

  if (!varunAssignment || !mayssaAssignment || !noahAssignment) {
    throw new Error("Expected pending assignments for Varun, Mayssa, and Noah.");
  }

  const cases = [
    {
      label: "HELP",
      from: "whatsapp:+4917613420040",
      body: "HELP"
    },
    {
      label: "TASKS",
      from: "whatsapp:+4917613420040",
      body: "TASKS"
    },
    {
      label: "STATUS",
      from: "whatsapp:+4917613420040",
      body: "STATUS"
    },
    {
      label: "NATURAL_LANGUAGE_SKIP_REASSIGN",
      from: "whatsapp:+4917613420040",
      body: "I can't do it today, skip"
    },
    {
      label: "DONE",
      from: "whatsapp:+4917613420040",
      body: `DONE ${varunAssignment.id}`
    },
    {
      label: "SKIP",
      from: "whatsapp:+491700000101",
      body: `SKIP ${mayssaAssignment.id} running late tonight`
    },
    {
      label: "RESCUE",
      from: "whatsapp:+491700000104",
      body: `RESCUE ${noahAssignment.id}`
    },
    {
      label: "UNKNOWN",
      from: "whatsapp:+4917613420040",
      body: "WHO OWES WHAT RIGHT NOW?"
    }
  ];

  try {
    if (varunAssignment) {
      const { rememberLastOutboundAssignment } = await import(
        "../src/services/message-service.js"
      );
      rememberLastOutboundAssignment("whatsapp:+4917613420040", varunAssignment.id);
    }

    const outputs = [];
    for (const testCase of cases) {
      const result = await processInboundMessage({
        from: testCase.from,
        body: testCase.body
      });
      outputs.push({
        ...testCase,
        message: result.message
      });
    }

    const finalAssignments = taskService.listAssignments().map((assignment) => ({
      id: assignment.id,
      choreTitle: assignment.choreTitle,
      roommateName: assignment.roommateName,
      status: assignment.status,
      resolutionType: assignment.resolutionType,
      accountabilityState: assignment.accountabilityState,
      rescuedByRoommateName: assignment.rescuedByRoommateName
    }));
    const penalties = taskService.listPenalties().map((penalty) => ({
      id: penalty.id,
      roommateName: penalty.roommateName,
      status: penalty.status,
      reason: penalty.reason
    }));

    console.log("WhatsApp simulation ran against the configured Neon database.");
    console.log(`Snapshot path: ${config.snapshotPath}`);
    console.log("");

    for (const output of outputs) {
      console.log(`=== ${output.label} ===`);
      console.log(`FROM: ${output.from}`);
      console.log(`BODY: ${output.body}`);
      console.log(output.message);
      console.log("");
    }

    console.log("=== Final assignment states in simulation ===");
    console.log(JSON.stringify(finalAssignments, null, 2));
    console.log("");
    console.log("=== Penalties created in simulation ===");
    console.log(JSON.stringify(penalties, null, 2));
  } finally {
    void db;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
