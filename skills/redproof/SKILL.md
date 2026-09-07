---
name: redproof
description: Proves that a check can fail before anyone trusts it. Breaks the smallest thing the check guards, confirms red for the right rule, restores, and confirms green. Holds the rule for when a proof is owed and, far more often, when it is not. Use when a guard was written and passed on its first run. Use when you changed what a check looks at, such as a glob, an ignore list, a rule selection, a severity, a threshold, or a timeout. Use when you edited an expected value to match your own output. Use before you rely on or cite a check you have never seen go red. Use when a check can only print success. Use when the user asks for a red-proof. Not for feature work, refactors, renames, documentation, or a suite run the user asked for.
domain: engineering
role: sensor
stage: verify
---

# redproof — a green run is not evidence the check works

A check went green. That means one of two things. The code is correct, or the
check is blind. The two look identical from the outside.

A **red-proof** removes the doubt. You break the smallest thing the check
guards. You confirm the check goes red for the right rule. You restore, and you
confirm green again.

This matters most where failure is quiet. A check that can only print success
looks exactly like a check that works.

## Is a proof owed?

The description above is wide on purpose, so this skill loads often. Most loads
end here with no proof. **This section is the authority, not the description.**

**Default: no.** A real workday is ordinary work. Do not offer a proof every
turn.

A proof is owed only when both are true.

1. **The guard is unproven to you.** You have never seen it go red. You wrote it
   and it passed on its first run. Or you changed it, weakened it, or are about
   to rely on it or cite it.
2. **A blind pass would be quiet.** If the check stopped detecting tomorrow, no
   other signal would say so.

One "no" ends it. Do the work and move on.

There are three outcomes, not two. Say which one you reached.

```text
NO PROOF             one answer was no. Say nothing about red-proofs.
PROOF                both were yes. Run the loop.
OWED, NOT PROVED     both were yes, and no safe break exists.
```

For a borderline case, read [`verdicts.md`](verdicts.md) first. It holds 33
worked verdicts and answers most cases on sight.

### Quiet or loud

Question 2 decides most cases, so answer it first.

A blind pass is **quiet** when the only evidence is the word "pass". These four
shapes print success forever:

- **The check never runs.** A glob matches no files. A path is wrong. A job
  condition is false.
- **The failure is swallowed.** A script ends with `|| true`. A job sets
  `continue-on-error: true`. A `try` block catches the assertion error.
- **The tool exits 0 when it cannot work.** A missing config file, zero input
  files, or a parse error can all end in a success status.
- **The check reads a stale report.** The report is from an earlier run. The
  current run wrote nothing.

A blind pass is **loud** when a person would see the fault within seconds. A
compile error, a crash at start, a missing binary, or wrong output on screen.
Loud faults need no proof. The world already tells you.

Six more ways a check goes blind are in [`breaking.md`](breaking.md).

### These count as touching the guard

You did not edit the check, and the guard is still unproven. Treat all four as
question 1 answered yes.

- You **edited an expected value** to match your own new output.
- You **changed what the check looks at**: a glob, an ignore list, a rule
  selection, a severity, a threshold, or a timeout.
- The check **passed unchanged before and after** your change, and you now say
  it covers the new code.
- You are **about to rely on or cite** a check you have never seen go red.

This list is the one agents miss. A new check looks like detector work. A
loosened old check does not.

### Never prove these

- Feature code, bug fixes, refactors, renames, formatting, documentation.
- A suite run the user asked for. Report the result. Offer the proof in one
  line. Do not perform it.
- A test you already watched fail before you made it pass. The red already
  happened.
- A check that fails often in real use. The field has proved it.
- A third-party engine. Prove your rule selection and your wiring. Do not prove
  the vendor's parser.
- Spikes, throwaway scripts, and code you will delete today.
- A deleted file, unless it held a test the runner collected. Check that first.

### Two cases that end the question early

**The check already confessed.** Its own output says it inspected nothing.
`Checked 0 links.` and exit 0 is not a case for a proof. It is the finding. Say
the check is blind, and fix it. Do not run the loop.

**No safe break exists.** Some guards cannot be broken cheaply. You would have
to install a package with a known fault, edit a lock file, or touch a system
outside the repository. Do not force it. The verdict is OWED, NOT PROVED. A
stated limit is a real report.

### Cost

One proof costs a few minutes. Ten proofs cost an hour, and they edit files
nobody asked you to touch. Prove the one check that carries the most weight.
Name the checks you skipped, and stop.

If the check takes more than about two minutes to run, ask the user first.

## The loop

Run these steps in order. Do not reorder them.

1. **State the rule.** Write one sentence. What must be true?
2. **Plan the restore.** Decide how you will undo the break, before you make it.
3. **Choose the smallest break.** It must violate that one rule and nothing
   else. See [`breaking.md`](breaking.md).
4. **Break it.** Break the thing being checked. Never break the check.
5. **Run the same check.** Same command, same arguments, same scope. A narrowed
   check proves a different check.
6. **Read the output.** Confirm red. Confirm the message names your rule.
7. **Restore.**
8. **Run the check again.** Confirm green.
9. **Report the red and the green.**

Step 6 is the step agents skip. A red for the wrong reason is not a proof.

## Safety

A break left behind is worse than no proof. These rules are not optional.

- **Restore before you stop.** If you must abandon the loop, restore first, then
  say so.
- **One break at a time.**
- **Check the file first.** Run `git status` on that path. Do not break a file
  that holds work you cannot restore.
- **Never commit or push while a break is planted.**
- **Never break live things.** No production config, no secrets, no migration
  that runs at start, no real payment, no real email.
- **If the restore fails, stop.** Name the file. Tell the user. Do not continue.

## When the check stays green

The check is blind. That is the finding, and the exercise worked.

Do not make the break bigger to force a red. That proves nothing.

Check three things, in order. Did the check really run? Was the break inside the
scope the check reads? Did something swallow the failure?

Then report the gap. Say which rule is now unguarded. Fix the check only if the
user asked for a fix.

## Report

Show both results. "It passes" is not a report here.

```text
Red-proof: <the rule, in one sentence>
  break     <file:line, and what changed>
  red       <the output line that named the rule>
  restore   <how, and confirmed clean>
  green     <the check passing again>
```

When the verdict was OWED, NOT PROVED, report that instead.

```text
Owed, not proved: <the rule>
  why not   <the reason no safe break exists>
```

Then say what you did not prove, and why. A skipped proof is a decision, not an
omission.

## Make a proof repeat

A manual proof is true once, for the code you had that day. The check can go
blind next month and the old proof will not notice.

Redproof is a library. It stores the break next to the check and repeats the
loop on every commit. Use it when the guard is permanent. Do not use it for a
one-time proof.

Read the README and the docs on GitHub. Those files ship with the code, so
they cannot go stale.

- <https://github.com/schalermthai/redproof#readme>
- <https://github.com/schalermthai/redproof/tree/main/docs>
