// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { App } from "../App";

// jsdom lacks <dialog> methods
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const wait = () => act(() => new Promise((r) => setTimeout(r, 20)));
const byText = (sel: string, text: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.includes(text));
async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function go(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await wait();
}

describe("app smoke test (local mode)", () => {
  it("renders every screen and handles basic flows", async () => {
    localStorage.setItem("logger.config", JSON.stringify({ mode: "local" }));
    const root = document.createElement("div");
    document.body.appendChild(root);
    await act(async () => createRoot(root).render(<App />));
    await wait();
    expect(document.body.textContent).toContain("Nothing planned for today");

    // Inbox: brain dump two lines
    await go("#/inbox");
    await type(document.querySelector("textarea")!, "email professor\n- fix plots");
    await act(async () => byText("button", "Add to inbox")!.click());
    expect(document.body.textContent).toContain("Inbox (2)");

    // Projects: create one, add a Submittable task
    await go("#/projects");
    await type(document.querySelector<HTMLInputElement>(".quick-add input")!, "RA Outreach");
    await act(async () => document.querySelector<HTMLFormElement>(".quick-add")!.requestSubmit());
    await wait();
    expect(window.location.hash).toMatch(/#\/projects\/p_/);
    const addSubmittable = document.querySelector<HTMLInputElement>('input[placeholder="Add to Submittable…"]')!;
    await type(addSubmittable, "Write the email template");
    await act(async () => addSubmittable.form!.requestSubmit());
    expect(document.body.textContent).toContain("Write the email template");

    // Open the task, plan it for today
    await act(async () => byText(".task-title", "Write the email template")!.click());
    await act(async () => byText("dialog button", "Today")!.click());
    await act(async () => byText("dialog button", "1h")!.click());
    const tagInput = document.querySelector<HTMLInputElement>('dialog input[placeholder="add tag"]')!;
    await type(tagInput, "Writing");
    await act(async () => tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(byText("dialog button", "#writing")).toBeTruthy();
    await act(async () => byText("dialog button", "Close")!.click());

    // Today shows it; check it off with "took 1.5h"
    await go("#/today");
    expect(document.body.textContent).toContain("0 of 1 planned done");
    await act(async () => document.querySelector<HTMLButtonElement>(".task-row .check")!.click());
    expect(document.body.textContent).toContain("Took about how long?");
    await act(async () => byText("dialog button", "1.5h")!.click());
    expect(document.body.textContent).toContain("1 of 1 planned done");

    // Week, Record, Settings render; add a habit and log it
    await go("#/week");
    expect(document.body.textContent).toContain("Not scheduled");
    await go("#/settings");
    await type(document.querySelector<HTMLInputElement>('input[placeholder="New habit"]')!, "Meditation");
    await act(async () => document.querySelector<HTMLInputElement>('input[placeholder="New habit"]')!.form!.requestSubmit());
    await go("#/today");
    await act(async () => byText(".habit", "Meditation")!.click());
    expect(byText(".habit", "Meditation")!.textContent).toContain("1 of 3 this week");
    await go("#/stats");
    expect(document.body.textContent).toContain("Planned vs. done");
    // Today isn't finished yet, so it isn't in the 30-day average; it is in the heatmap
    expect(document.body.textContent).toContain("No finished planned days yet");
    expect(document.body.textContent).toContain("#writing");
    expect(document.querySelector('.cell.l4[role="button"]')).not.toBeNull();
  });
});
