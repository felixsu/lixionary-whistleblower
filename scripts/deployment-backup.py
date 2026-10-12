#!/usr/bin/env python3
"""Stream an authenticated deployment snapshot; never print data or keys."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b"WBDEPLOY1\n"
CHUNK = 1024 * 1024
MAX_BYTES = 60 * 1024 ** 3


def encrypt(folder, archive, key_file):
    folder, archive, key_file = map(Path, (folder, archive, key_file))
    if archive.exists() or key_file.exists():
        raise ValueError("Snapshot/key output must be new")
    if not folder.is_dir() or folder.resolve() in archive.resolve().parents or folder.resolve() in key_file.resolve().parents:
        raise ValueError("Choose a source directory and an output outside it")
    key, nonce = os.urandom(32), os.urandom(12)
    header = MAGIC + nonce
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(header)
    process = None
    key_created = archive_created = False
    try:
        with key_file.open("xb") as f:
            key_created = True
            key_file.chmod(0o600)
            f.write(key)
            f.flush()
            os.fsync(f.fileno())
        process = subprocess.Popen(
            ["tar", "-C", str(folder), "-cf", "-", "."],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        with archive.open("xb") as f:
            archive_created = True
            archive.chmod(0o600)
            f.write(header)
            total = 0
            while chunk := process.stdout.read(CHUNK):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError("Snapshot exceeds the 60 GiB deployment limit")
                f.write(encryptor.update(chunk))
            if process.wait() != 0:
                raise ValueError("Snapshot archive failed")
            f.write(encryptor.finalize())
            f.write(encryptor.tag)
            f.flush()
            os.fsync(f.fileno())
    except BaseException:
        if process is not None:
            process.kill()
            process.wait()
        if archive_created:
            archive.unlink(missing_ok=True)
        if key_created:
            key_file.unlink(missing_ok=True)
        raise


def decrypt(archive, key_file, output):
    archive, key_file, output = map(Path, (archive, key_file, output))
    if output.exists():
        raise ValueError("Decrypted output must be new")
    size = archive.stat().st_size
    with archive.open("rb") as src:
        header = src.read(len(MAGIC) + 12)
        if size < len(header) + 16 or not header.startswith(MAGIC):
            raise ValueError("Invalid snapshot format")
        if size - len(header) - 16 > MAX_BYTES:
            raise ValueError("Snapshot exceeds the 60 GiB deployment limit")
        src.seek(-16, os.SEEK_END)
        tag = src.read(16)
        decryptor = Cipher(
            algorithms.AES(key_file.read_bytes()), modes.GCM(header[-12:], tag)
        ).decryptor()
        decryptor.authenticate_additional_data(header)
        src.seek(len(header))
        fd, name = tempfile.mkstemp(prefix=".wb-decrypt-", dir=output.parent)
        try:
            remaining = size - len(header) - 16
            with os.fdopen(fd, "wb") as dest:
                while remaining:
                    chunk = src.read(min(CHUNK, remaining))
                    if not chunk:
                        raise ValueError("Truncated snapshot")
                    remaining -= len(chunk)
                    dest.write(decryptor.update(chunk))
                dest.write(decryptor.finalize())
                dest.flush()
                os.fsync(dest.fileno())
            # Publish only authenticated plaintext, without overwriting a file.
            os.link(name, output)
        finally:
            Path(name).unlink(missing_ok=True)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        if len(sys.argv) != 5 or sys.argv[1] not in ("encrypt", "decrypt"):
            raise ValueError("Usage: deployment-backup.py encrypt DIR ARCHIVE KEY | decrypt ARCHIVE KEY TAR")
        if sys.argv[1] == "encrypt":
            encrypt(*sys.argv[2:])
        else:
            decrypt(*sys.argv[2:])
        print("Deployment snapshot operation completed.")
    except Exception:
        print("Deployment snapshot operation failed; no authenticated output was published.", file=sys.stderr)
        sys.exit(1)
