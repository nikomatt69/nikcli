# Text-to-Speech (TTS) Setup Guide

The `speak` tool allows AI to generate voice messages that play on your device speakers. Two providers are supported: **ElevenLabs** and **OpenRouter**.

## Quick Start

### 1. Choose a Provider

**Option A: OpenRouter (Easiest - OpenAI TTS)**

```bash
# Set your OpenRouter API key
export NIKCLI_OPENROUTER_API_KEY="your-api-key"

# Or authenticate
nikcli auth login
# Select: openrouter
```

**Option B: ElevenLabs (Best voice quality)**

```bash
# Set your ElevenLabs API key
export NIKCLI_ELEVENLABS_API_KEY="your-api-key"

# Or create the key file
mkdir -p ~/.config/nikcli/secrets
echo "your-api-key" > ~/.config/nikcli/secrets/elevenlabs-key
```

### 2. Configure in nikcli.json (Optional)

```json
{
  "speak": {
    "provider": "openrouter",
    "model": "alloy",
    "modelId": "openai/gpt-audio-mini",
    "outputFormat": "mp3"
  }
}
```

**Config Options:**

- `provider`: `"openrouter"` or `"elevenlabs"` (default: "openrouter")
- `model`: Voice ID (e.g., "alloy", "YOq2y2Up4RgXP2HyXjE5")
- `modelId`: TTS model (ElevenLabs: "eleven_v3", OpenRouter: "openai/gpt-audio-mini")
- `outputFormat`: Audio format (e.g., "mp3", "wav")

### 3. Permissions (Optional)

Allow the speak tool in your config:

```json
{
  "permission": {
    "speak": "allow"
  }
}
```

Or pattern-specific:

```json
{
  "permission": {
    "speak": {
      "openrouter:alloy": "allow",
      "openrouter*": "allow"
    }
  }
}
```

## Usage

### Tell AI to speak:

```
Tell me about machine learning, and speak the explanation out loud.
```

### Parameters the AI can control:

- **text**: Text to speak
- **provider**: "elevenlabs" or "openrouter"
- **voiceId**: Specific voice (overrides config)
- **modelId**: Specific model
- **stability**: 0-1 (lower = more expressive, ElevenLabs only)
- **similarityBoost**: 0-1 (voice similarity boost, ElevenLabs only)
- **speed**: 0.5-2 (playback speed)
- **volume**: 0-2 (system volume multiplier)
- **outputFormat**: "mp3", "wav", etc.

### Example in context:

```
Create a summary of this code and speak it with a happy tone using the Bella voice.
```

## Voices

### OpenRouter Voices (OpenAI TTS):

- alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer

### ElevenLabs Voices:

- Rachel, Sam, Roger, Sarah, Elliot, Charlie, Emily, Aria, Adam, Arnold, Bella, Dom, Dorothy, Fin, Freya, Grace, James, Jenny, Matthew

## System Requirements

One of these audio players must be installed:

- **macOS**: `afplay` (built-in)
- **Linux/Windows**: `ffplay` (from ffmpeg) or `mpg123`

```bash
# Install on Linux
sudo apt-get install ffmpeg  # or mpg123

# Install on macOS (ffmpeg alternative)
brew install ffmpeg
```

## Troubleshooting

### "No supported audio player found"

Install one of: `afplay`, `ffplay`, or `mpg123`

### "API key not found"

- Verify env var is set: `echo $NIKCLI_OPENROUTER_API_KEY`
- Check file permissions on key file
- Run `nikcli auth login` to set credentials

### "All TTS providers failed"

- Check internet connection
- Verify API key is valid
- Try the other provider
- Check logs: Look for timeout or authentication errors

### Audio not playing

- Verify system audio is enabled
- Check volume levels
- Try `-v` flag to increase volume
- Test with `afplay`, `ffplay`, or `mpg123` directly

## Features

✅ Multiple providers with automatic fallback
✅ Non-blocking audio playback (continues while listening)
✅ Audio quality control (format, speed, stability)
✅ Voice customization
✅ Text truncation for long inputs
✅ Comprehensive error handling
✅ Permission-based control
