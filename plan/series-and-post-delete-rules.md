### Feature Specification: Content Series Lifecycle & Archival Management

#### 1. Objective

To define a robust, state-machine-driven logic for handling the lifecycle of Content Series and individual Posts. The goal is to enforce chronological content cadence, prevent the accidental destruction of historical data (already published content), and provide users with a safe "Archival" mechanism (Local Soft Delete) rather than dangerous hard deletions.

#### 2. Core Principle: Sequential Integrity

A Content Series is defined as a **chronological sequence** (e.g., Teaser → Announcement → Follow-up). The system enforces a strict time-based cadence:

- **Constraint:** Within the same Series, `Scheduled Time (Post N)` MUST strictly be earlier than `Scheduled Time (Post N+1)`.
- **Validation:** The backend API must reject any update or creation request that violates this sequential time order.

#### 3. State Definitions

Every `Post` entity utilizes a `status` enum field. The system recognizes four primary states:

- **`DRAFT`**: Work in progress. Time constraints are flexible.
- **`SCHEDULED`**: Locked in the timeline, awaiting execution to the target platform.
- **`PUBLISHED`**: Successfully pushed to the external platform (LinkedIn/Instagram). Serves as a historical, immutable record.
- **`ARCHIVED`**: (New) Soft-deleted or retired content. Removed from the active user dashboard but retained in the database for historical integrity.

---

#### 4. Single Post Action Logic

When a user attempts to remove an individual post from a Series, the action and resulting state depend strictly on the current status of that post.

- **Target State: `DRAFT` or `SCHEDULED`**
  - **Backend Logic:** Hard deletion of the `Post` record is allowed, as it has not impacted the real world. The parent `Series` remains intact.
  - **UX/UI:** Standard "Delete" icon is visible. Deleting dynamically removes the node from the Series timeline and frees up the time slot.

- **Target State: `PUBLISHED`**
  - **Backend Logic:** **Block Hard Deletion.** The API rejects `DELETE` requests. Instead, it accepts a state update to `ARCHIVED` (Local Soft Delete).
  - **UX/UI:** The "Delete" button is replaced by an "Archive" button. Clicking this hides the post from the active UI list (out of sight), but preserves the database integrity.

---

#### 5. Entire Series Lifecycle Logic

When a user attempts to remove an entire Content Series, the system evaluates the Execution Milestone of the series to determine the safe path.

- **Scenario A: Pre-Execution (The series has NOT started)**
  - **Condition:** All child posts are either `DRAFT` or `SCHEDULED` (Zero `PUBLISHED` posts).
  - **Backend Logic:** Allow full cascade deletion. Safely hard-delete the parent `Series` and all associated `Post` records.
  - **UX/UI:** Standard "Delete Series" action with a confirmation modal.

- **Scenario B: In-Progress or Completed (The series has started)**
  - **Condition:** At least one child post in the series has the status `PUBLISHED`.
  - **Backend Logic:** **Prevent Hard Deletion.** Trigger an **"Archive Series"** workflow:
    1. Update the parent `Series` status to `ARCHIVED`.
    2. Retain all child posts with `status == PUBLISHED` (optionally mark them as `ARCHIVED` to clear the UI).
    3. Update all unexecuted child posts (`status == DRAFT` or `SCHEDULED`) to `ARCHIVED`, effectively canceling their future execution.
  - **UX/UI:** The action menu shows "Archive Series" instead of "Delete". The confirmation modal states: _"This series is already in progress. Future posts will be canceled, and the entire series will be archived to preserve your history."_
