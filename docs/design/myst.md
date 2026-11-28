(design-myst)=

# How oak runs MyST

% To write: how oak calls MyST as a library, what it hands MyST (myst.oak.yml, the templates) and what it leaves to it.

(design-myst-flags)=
## MyST's flags

`oak build` and `oak start` pass a subset of MyST's flags on to MyST, such as `--port`, for these reasons:

- oak builds what the journal's settings ask for, such as the PDF with the journal's template and the website with its theme. MyST flags such as `--pdf` or `-o` would change what is built or where it is written.
- A paper should build the same on every machine, and the CI workflows pass no MyST flags.[^local-flags]
- Some flags need more than passing on. Running notebooks with `--execute` needs setup oak does not do yet.
- A small set of flags keeps oak simple to maintain as MyST changes.

[^local-flags]: Is there a feature you'd like for local use or testing? [Open an issue](https://github.com/Open-Scholar-Nexus/oaktree-sapling/issues) to let us know.
