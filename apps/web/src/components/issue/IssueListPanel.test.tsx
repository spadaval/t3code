import type { ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capturedProps: Array<Record<string, unknown>> = [];

vi.mock("./IssueList", () => ({
  IssueList: (props: Record<string, unknown>) => {
    capturedProps.push(props);
    return <div>Mock Issue List</div>;
  },
}));

import { IssueListPanel } from "./IssueListPanel";

describe("IssueListPanel", () => {
  beforeEach(() => {
    capturedProps.length = 0;
  });

  it("passes issue context actions through to IssueList", () => {
    const onIssueContextAction = vi.fn();

    renderToStaticMarkup(
      <IssueListPanel
        threadId={"thread-1" as ThreadId}
        issues={[]}
        onIssueContextAction={onIssueContextAction}
      />,
    );

    expect(capturedProps).toHaveLength(1);
    expect(capturedProps[0]?.onIssueContextAction).toBe(onIssueContextAction);
  });
});
