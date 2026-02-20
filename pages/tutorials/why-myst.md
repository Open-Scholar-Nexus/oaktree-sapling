---
title: Why MyST?
description: Why we chose MyST for scientific micropublications
---

# Why MyST?

## It's easy to learn

MyST is Markdown with extras for academic writing: citations, cross-references, math, figures. If you've written a GitHub README, you can write a MyST paper.

## Structure, not just formatting

MyST parses your document into an AST: a tree where every heading, figure, citation is a typed node. The tooling knows *what* things are, not just how they look. That's what lets you get a website and a PDF from a single source without any extra work.

## Papers as a rich website

Thankfully, MyST includes an interactive, responsive and well-formatted "exporter". It's not just a dumped HTML page: readers get hover previews on references, client-side navigation, responsive layout. You can still export to PDF from the same source when you need to.

## Plain text in a git repo

Your paper is text files in a repo. Every edit is tracked, every version recoverable, no opaque binary formats. MyST is mature enough to let us specify shared templates. That's one of the reasons why our template repo extends a shared configuration; check out [](myst-deeper.md) 

## Scholarly publishing compatibility

MyST also exports to JATS XML, the standard format used by publishers and indexed by PubMed, CrossRef, and friends. Your micropublication is machine-readable from day one.

## Built in the open

MyST comes from the [Executable Books](https://executablebooks.org) community and [Curvenote](https://curvenote.com), and is tied to the Jupyter ecosystem. It's built by researchers, for researchers.
