# Creator Scheduler Assignment

## Context

This project is a simple **Creator Content Scheduler**.

Creators can schedule posts for platforms like Instagram or LinkedIn.

The existing system already supports:

- Creating posts
- Listing posts
- Storing a `scheduled_at` timestamp
- A basic React UI to view and create posts

The system works today for **individual posts**, but creators often plan content as **a sequence or series of posts** rather than isolated posts.

For example:

- Launch teaser
- Launch announcement
- Follow-up post
- Reminder post

These posts are usually scheduled relative to a starting point and follow a consistent cadence.

---

## Your Task

Extend the system to support the concept of a **Content Series**.

A series represents a structured set of posts that follow a predictable schedule.

For example:

- A series might start on a specific date
- Posts may occur daily or weekly
- Posts may be positioned relative to the start of the series

You are free to decide:

- how series should be modeled
- how posts should relate to a series
- how scheduling should be computed
- what API endpoints or UI changes make sense

Focus on designing something that **fits naturally into the existing system**.

Avoid rewriting the project from scratch.

---

## Scheduling Constraint

One important constraint to support:

Posts scheduled on the **same platform** should not occur within **15 minutes** of each other.

How you enforce this is up to you.

---

## Time Expectation

Please **timebox this to ~3 hours**.

We are not expecting a production-ready system.

Prioritize:

- clear structure
- reasonable assumptions
- working behavior

---

## Deliverables

Please submit your work as a **Pull Request**.

Steps:

1. Create a branch in your repository
2. Implement your solution
3. Open a **Pull Request into your `main` branch**
4. Share the PR link with us

Submitting a PR makes it easier for us to review the changes and understand your approach.

In the PR description, please include:

- your approach
- any assumptions you made
- tradeoffs in your design
- what you would improve with more time
- a short **Loom video (5–10 minutes)** walking through your solution and explaining the key parts of the implementation
