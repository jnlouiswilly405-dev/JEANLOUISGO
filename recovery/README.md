# JEANLOUISGO V45 recovery package

Download `JEANLOUISGO-v45-complete-recovery-20261124.tar.gz` and
`SHA256SUMS` from this directory. The archive contains the unchanged original
13-file preservation archive, a Git bundle for
`fix/v45-pilot-review-20261124`, and a patch for the review commit.

Verify the download before extracting:

```sh
sha256sum -c SHA256SUMS
```

On macOS, use `shasum -a 256 -c SHA256SUMS`. Then extract with:

```sh
tar -xzf JEANLOUISGO-v45-complete-recovery-20261124.tar.gz
```

To restore the review branch into an existing checkout, first verify the
included bundle with `git bundle verify <bundle-file>`, then fetch the branch
from it. Keep the original archive and package checksum file as-is.

Migration 019 was not applied, and the historical ledger audit was not run.
This package is a recovery artifact, not authorization to deploy or enable
live payments, refunds, Connect, or payouts.
