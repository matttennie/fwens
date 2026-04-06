#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { runInit } from "./commands/init.js";
import { runStatus } from "./commands/status.js";
import { runTasks } from "./commands/tasks.js";
import { runReviews } from "./commands/reviews.js";
import { runMessages } from "./commands/messages.js";
import { runSessions } from "./commands/sessions.js";
import { runSeed } from "./commands/seed.js";
import { runWatch } from "./commands/watch.js";

const program = new Command();

program
  .name("fwens")
  .description("CLI for inspecting fwens project state")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize a fwens project in the given directory")
  .argument("[dir]", "project directory", process.cwd())
  .action((dir: string) => {
    runInit(path.resolve(dir));
  });

program
  .command("status")
  .description("Show task counts, pending reviews, and active sessions")
  .argument("[dir]", "project directory", process.cwd())
  .action((dir: string) => {
    runStatus(path.resolve(dir));
  });

program
  .command("tasks")
  .description("List tasks with optional status filter")
  .argument("[dir]", "project directory", process.cwd())
  .option("--filter <status>", "filter tasks by status")
  .action((dir: string, opts: { filter?: string }) => {
    runTasks(path.resolve(dir), opts.filter);
  });

program
  .command("reviews")
  .description("List reviews with optional pending filter")
  .argument("[dir]", "project directory", process.cwd())
  .option("--pending", "show only pending reviews")
  .action((dir: string, opts: { pending?: boolean }) => {
    runReviews(path.resolve(dir), opts.pending);
  });

program
  .command("messages")
  .description("Read messages with optional channel filter")
  .argument("[dir]", "project directory", process.cwd())
  .option("--channel <channel>", "filter by channel name")
  .action((dir: string, opts: { channel?: string }) => {
    runMessages(path.resolve(dir), opts.channel);
  });

program
  .command("sessions")
  .description("List all sessions")
  .argument("[dir]", "project directory", process.cwd())
  .action((dir: string) => {
    runSessions(path.resolve(dir));
  });

program
  .command("seed")
  .description("Seed tasks from a markdown file into the fwens database")
  .argument("<taskfile>", "markdown file with task definitions")
  .argument("[dir]", "project directory", process.cwd())
  .action((taskfile: string, dir: string) => {
    runSeed(path.resolve(dir), taskfile);
  });

program
  .command("watch")
  .description("Live dashboard showing agents, tasks, and status")
  .argument("[dir]", "project directory", process.cwd())
  .option("--poll <ms>", "poll interval in milliseconds", "1500")
  .action((dir: string, opts: { poll: string }) => {
    runWatch(path.resolve(dir), parseInt(opts.poll, 10));
  });

program.parse();
