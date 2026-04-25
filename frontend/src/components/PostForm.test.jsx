// Tests for the PostForm status lockdown + manual publish flow (006).
//
// Covers:
//   - FR-016: status dropdown for a draft post offers exactly Draft /
//     Scheduled / Archived (no Published, no Failed).
//   - FR-017: a post that is already `published` shows status as a
//     read-only label, not a dropdown.
//   - Q2 / FR-015b: clicking "Publish post" + Cancel = no API call.
//   - Q2 / FR-015b: clicking "Publish post" + Confirm = exactly one
//     postsApi.publish() call + parent refresh callback fired.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import PostForm from "./PostForm";
import { postsApi } from "../api/client";

vi.mock("../api/client", () => ({
  postsApi: {
    publish: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const draftPost = {
  id: 1,
  title: "Hello",
  platform: "instagram",
  status: "draft",
  scheduled_at: null,
};

const publishedPost = {
  id: 2,
  title: "Already shipped",
  platform: "instagram",
  status: "published",
  scheduled_at: "2026-04-30T13:00:00",
};

const scheduledPost = {
  id: 3,
  title: "Scheduled one",
  platform: "instagram",
  status: "scheduled",
  scheduled_at: "2026-05-01T13:00:00",
};


describe("PostForm — 006 status lockdown & manual publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("status dropdown for a draft post shows exactly Draft / Scheduled / Archived", () => {
    render(
      <PostForm
        editing={draftPost}
        existingPosts={[]}
        onSaved={() => {}}
        onCancel={() => {}}
      />
    );
    const select = screen.getByTestId("status-select");
    const options = within(select).getAllByRole("option").map((o) => o.value);
    expect(options).toEqual(["draft", "scheduled", "archived"]);
    expect(options).not.toContain("published");
    expect(options).not.toContain("failed");
  });

  it("renders status as a read-only label for an already-published post", () => {
    render(
      <PostForm
        editing={publishedPost}
        existingPosts={[]}
        onSaved={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByTestId("status-select")).toBeNull();
    expect(screen.getByTestId("status-readonly")).toBeInTheDocument();
    expect(screen.getByTestId("status-readonly")).toHaveTextContent("Published");
  });

  it("Publish post button is hidden for already-published posts", () => {
    render(
      <PostForm
        editing={publishedPost}
        existingPosts={[]}
        onSaved={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByTestId("publish-button")).toBeNull();
  });

  it("Publish + Cancel does NOT call postsApi.publish", () => {
    const onConfirm = vi.fn();
    render(
      <PostForm
        editing={scheduledPost}
        existingPosts={[]}
        onSaved={() => {}}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByTestId("publish-button"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Simulate the user clicking Cancel: never invoke spec.onConfirm.
    expect(postsApi.publish).not.toHaveBeenCalled();
  });

  it("Publish + Confirm calls postsApi.publish exactly once and triggers onSaved", async () => {
    const onSaved = vi.fn();
    let confirmSpec = null;
    const onConfirm = (spec) => {
      confirmSpec = spec;
    };
    postsApi.publish.mockResolvedValueOnce({
      ...scheduledPost,
      status: "published",
    });

    render(
      <PostForm
        editing={scheduledPost}
        existingPosts={[]}
        onSaved={onSaved}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByTestId("publish-button"));
    expect(confirmSpec).not.toBeNull();
    expect(typeof confirmSpec.onConfirm).toBe("function");

    // Simulate the user clicking Confirm in the modal.
    await confirmSpec.onConfirm();

    expect(postsApi.publish).toHaveBeenCalledTimes(1);
    expect(postsApi.publish).toHaveBeenCalledWith(scheduledPost.id);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0][0].status).toBe("published");
  });
});
