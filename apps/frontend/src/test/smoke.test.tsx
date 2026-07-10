import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

describe("frontend 測試基建 smoke", () => {
  it("能渲染並查詢節點", () => {
    render(<div>安安</div>);
    expect(screen.getByText("安安")).toBeInTheDocument();
  });
});
