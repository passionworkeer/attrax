import {describe,expect,it} from "vitest";
import nextConfig from "@/next.config";

describe("local browser development origin",()=>{
  it("allows the documented 127.0.0.1 host to load Next development assets",()=>{
    expect(nextConfig.allowedDevOrigins).toContain("127.0.0.1");
  });
});
