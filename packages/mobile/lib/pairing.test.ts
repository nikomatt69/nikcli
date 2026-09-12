/// <reference types="@types/bun" />

import { describe, expect, test } from "bun:test"
import { parsePairingPayload } from "./pairing"

describe("parsePairingPayload", () => {
  test("reads the CLI / TUI nikcli://connect deep link", () => {
    expect(
      parsePairingPayload(
        "nikcli://connect?server=http://192.168.1.10:4096&token=nkm_abc&directory=/Users/me/proj",
      ),
    ).toEqual({
      url: "http://192.168.1.10:4096",
      token: "nkm_abc",
      directory: "/Users/me/proj",
    })
  })

  test("accepts the root nikcli:// form and encoded query values", () => {
    expect(
      parsePairingPayload(
        "nikcli://?server=http%3A%2F%2F10.0.0.4%3A4096&token=nkm_xyz&directory=%2Ftmp%2Fapp",
      ),
    ).toEqual({
      url: "http://10.0.0.4:4096",
      token: "nkm_xyz",
      directory: "/tmp/app",
    })
  })

  test("pulls a deep link out of surrounding terminal output", () => {
    const blob = [
      "Nikcli Mobile Pairing",
      "Server URL: http://192.168.1.5:4096",
      "Deep Link:  nikcli://connect?server=http://192.168.1.5:4096&token=nkm_paste",
    ].join("\n")

    expect(parsePairingPayload(blob)).toEqual({
      url: "http://192.168.1.5:4096",
      token: "nkm_paste",
    })
  })

  test("treats a raw http(s) URL as a server-only pairing", () => {
    expect(parsePairingPayload("https://nikcli.example.com/")).toEqual({
      url: "https://nikcli.example.com",
    })
    expect(parsePairingPayload("http://10.0.0.8:4096")).toEqual({
      url: "http://10.0.0.8:4096",
    })
  })

  test("ignores unrelated schemes and empty input", () => {
    expect(parsePairingPayload("")).toBeNull()
    expect(parsePairingPayload("exp://127.0.0.1:8081")).toBeNull()
    expect(parsePairingPayload("nikcli://auth/callback?code=abc")).toBeNull()
    expect(parsePairingPayload("nikcli://connect")).toBeNull()
  })
})
