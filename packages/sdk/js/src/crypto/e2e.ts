export interface E2EIdentity {
  publicKey: string
  privateKey: string
}

export interface E2EPeer {
  id: string
  publicKey: string
}

export interface E2EEncryptedPayload {
  version: 1
  iv: string
  ciphertext: string
}

export class E2ECryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "E2ECryptoError"
  }
}

function getCrypto(): Crypto {
  if (!globalThis.crypto) {
    throw new E2ECryptoError("Web Crypto API is not available in this runtime")
  }
  return globalThis.crypto
}

function getSubtle(): SubtleCrypto {
  const subtle = getCrypto().subtle
  if (!subtle) {
    throw new E2ECryptoError("SubtleCrypto is not available in this runtime")
  }
  return subtle
}

function toBase64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64")
  }

  let text = ""
  for (const value of bytes) {
    text += String.fromCharCode(value)
  }
  return btoa(text)
}

function fromBase64(input: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(input, "base64"))
  }

  const decoded = atob(input)
  const bytes = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i)
  }
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const start = bytes.byteOffset
  const end = bytes.byteOffset + bytes.byteLength
  return bytes.buffer.slice(start, end) as ArrayBuffer
}

function ensurePeerKey(peerKey: CryptoKey | undefined, peerID: string): CryptoKey {
  if (!peerKey) {
    throw new E2ECryptoError(`Missing public key for peer '${peerID}'`)
  }
  return peerKey
}

export class E2ECrypto {
  private keyPair: CryptoKeyPair | null = null
  private readonly peerKeys = new Map<string, CryptoKey>()

  static async create(): Promise<E2ECrypto> {
    const instance = new E2ECrypto()
    await instance.generateIdentity()
    return instance
  }

  async generateIdentity(): Promise<E2EIdentity> {
    const subtle = getSubtle()
    this.keyPair = await subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      ["deriveKey"],
    )

    const publicKey = await subtle.exportKey("spki", this.keyPair.publicKey)
    const privateKey = await subtle.exportKey("pkcs8", this.keyPair.privateKey)

    return {
      publicKey: toBase64(publicKey),
      privateKey: toBase64(privateKey),
    }
  }

  async importIdentity(identity: E2EIdentity): Promise<void> {
    const subtle = getSubtle()

    const [publicKey, privateKey] = await Promise.all([
      subtle.importKey(
        "spki",
        toArrayBuffer(fromBase64(identity.publicKey)),
        {
          name: "ECDH",
          namedCurve: "P-256",
        },
        true,
        [],
      ),
      subtle.importKey(
        "pkcs8",
        toArrayBuffer(fromBase64(identity.privateKey)),
        {
          name: "ECDH",
          namedCurve: "P-256",
        },
        true,
        ["deriveKey"],
      ),
    ])

    this.keyPair = {
      publicKey,
      privateKey,
    }
  }

  async exportIdentity(): Promise<E2EIdentity> {
    if (!this.keyPair) {
      throw new E2ECryptoError("Identity has not been initialized")
    }

    const subtle = getSubtle()
    const [publicKey, privateKey] = await Promise.all([
      subtle.exportKey("spki", this.keyPair.publicKey),
      subtle.exportKey("pkcs8", this.keyPair.privateKey),
    ])

    return {
      publicKey: toBase64(publicKey),
      privateKey: toBase64(privateKey),
    }
  }

  async setPeer(peer: E2EPeer): Promise<void> {
    const subtle = getSubtle()
    const key = await subtle.importKey(
      "spki",
      toArrayBuffer(fromBase64(peer.publicKey)),
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      [],
    )

    this.peerKeys.set(peer.id, key)
  }

  removePeer(peerID: string): void {
    this.peerKeys.delete(peerID)
  }

  async fingerprint(publicKey: string): Promise<string> {
    const subtle = getSubtle()
    const digest = await subtle.digest("SHA-256", toArrayBuffer(fromBase64(publicKey)))
    return [...new Uint8Array(digest)]
      .map((item) => item.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32)
  }

  async encrypt(peerID: string, plaintext: string | Uint8Array): Promise<E2EEncryptedPayload> {
    if (!this.keyPair) {
      throw new E2ECryptoError("Identity has not been initialized")
    }

    const peerKey = ensurePeerKey(this.peerKeys.get(peerID), peerID)
    const subtle = getSubtle()

    const aesKey = await subtle.deriveKey(
      {
        name: "ECDH",
        public: peerKey,
      },
      this.keyPair.privateKey,
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["encrypt", "decrypt"],
    )

    const iv = getCrypto().getRandomValues(new Uint8Array(12))
    const data = typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext

    const encrypted = await subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
      },
      aesKey,
      toArrayBuffer(data),
    )

    return {
      version: 1,
      iv: toBase64(iv),
      ciphertext: toBase64(encrypted),
    }
  }

  async decrypt(peerID: string, payload: E2EEncryptedPayload): Promise<Uint8Array> {
    if (!this.keyPair) {
      throw new E2ECryptoError("Identity has not been initialized")
    }

    const peerKey = ensurePeerKey(this.peerKeys.get(peerID), peerID)
    const subtle = getSubtle()

    const aesKey = await subtle.deriveKey(
      {
        name: "ECDH",
        public: peerKey,
      },
      this.keyPair.privateKey,
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["encrypt", "decrypt"],
    )

    const decrypted = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(fromBase64(payload.iv)),
      },
      aesKey,
      toArrayBuffer(fromBase64(payload.ciphertext)),
    )

    return new Uint8Array(decrypted)
  }

  async decryptText(peerID: string, payload: E2EEncryptedPayload): Promise<string> {
    const decrypted = await this.decrypt(peerID, payload)
    return new TextDecoder().decode(decrypted)
  }
}
