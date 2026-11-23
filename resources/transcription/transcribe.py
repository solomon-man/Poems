"""Transcribe a local recording into timed Chinese LRC lines on the CPU."""

import hashlib
from http.client import HTTPException
import os
from pathlib import Path
import sys
import urllib.request


REVISION = "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"
FILES = {
    "config.json": "56a6d8110d311f19c8f0471e562832c7527f146b567275bfca59fcf7c184da9a",
    "model.bin": "d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9",
    "tokenizer.json": "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab",
    "vocabulary.txt": "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913",
}


def model_directory(root):
    custom = os.getenv("LOVE_HYMN_WHISPER_MODEL")
    if custom:
        directory = Path(custom)
        if not directory.is_dir():
            raise ValueError("指定的本地 Whisper 模型目录不存在")
        return directory

    directory = root / ("base-" + REVISION)
    directory.mkdir(parents=True, exist_ok=True)
    sources = ["https://huggingface.co", "https://hf-mirror.com"]
    for name, expected in FILES.items():
        target = directory / name
        if target.is_file():
            continue  # Only a fully downloaded, verified file is renamed here.
        partial = target.with_suffix(".part")
        for source in list(sources):
            url = f"{source}/Systran/faster-whisper-base/resolve/{REVISION}/{name}?download=true"
            try:
                digest = hashlib.sha256()
                with urllib.request.urlopen(url, timeout=15) as response, partial.open("wb") as output:
                    while chunk := response.read(1024 * 1024):
                        digest.update(chunk)
                        output.write(chunk)
                if digest.hexdigest() != expected:
                    raise ValueError("模型文件校验失败")
                partial.replace(target)
                sources.remove(source)
                sources.insert(0, source)
                break
            except (OSError, ValueError, HTTPException) as error:
                partial.unlink(missing_ok=True)
                last_error = error
        else:
            raise RuntimeError(f"无法下载模型 {name}，请检查网络后重试（{last_error}）")
    return directory


def format_line(start, text):
    hundredths = max(0, round(start * 100))
    minutes, rest = divmod(hundredths, 6000)
    seconds, fraction = divmod(rest, 100)
    return f"[{minutes:02d}:{seconds:02d}.{fraction:02d}]{' '.join(text.split())}"


def lyric_lines(segment):
    if not segment.words:
        if segment.text.strip():
            yield format_line(segment.start, segment.text)
        return
    text = ""
    start = end = segment.start
    for word in segment.words:
        if not word.word.strip():
            continue
        if text and (word.start - end >= 0.8 or len(text) >= 22 or text.endswith(("。", "！", "？", ".", "!", "?"))):
            yield format_line(start, text)
            text = ""
        if not text:
            start = word.start
        text += word.word
        end = word.end
    if text:
        yield format_line(start, text)


def main():
    from faster_whisper import WhisperModel

    audio_path, root = sys.argv[1:]
    model = WhisperModel(str(model_directory(Path(root))), device="cpu", compute_type="int8", local_files_only=True)
    segments, _ = model.transcribe(
        audio_path, language="zh", word_timestamps=True, condition_on_previous_text=False,
        vad_filter=True, vad_parameters={"threshold": 0.35, "min_silence_duration_ms": 800},
    )
    lines = [line for segment in segments for line in lyric_lines(segment)]
    if not lines:
        raise ValueError("未识别到可生成歌词的人声")
    print("\n".join(lines))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.exit(str(error))
