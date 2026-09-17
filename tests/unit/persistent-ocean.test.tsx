import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PersistentOcean } from "@/components/complipilot/persistent-ocean";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

it("keeps the same video element through home, loading, upload and back", () => {
  const { container, rerender } = render(<PersistentOcean><div>Home</div></PersistentOcean>);
  const video = container.querySelector("video");
  expect(video).not.toBeNull();
  route.pathname = "/upload";
  rerender(<PersistentOcean><div>Loading</div></PersistentOcean>);
  expect(container.querySelector("video")).toBe(video);
  rerender(<PersistentOcean><form>Upload</form></PersistentOcean>);
  expect(container.querySelector("video")).toBe(video);
  route.pathname = "/";
  rerender(<PersistentOcean><div>Home</div></PersistentOcean>);
  expect(container.querySelector("video")).toBe(video);
  route.pathname = "/pricing";
  rerender(<PersistentOcean><div>Plans</div></PersistentOcean>);
  expect(container.querySelector("video")).toBeNull();
});
