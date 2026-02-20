---
title: Why MyST?
description: Why we chose MyST for scientific micropublications
---

# Why MyST?

## It's easy to learn

MyST is built on Markdown — if you've written a README on GitHub, you're most of the way there. Unlike LaTeX, you don't need to learn a complex syntax to get started. MyST adds academic features (citations, cross-references, math, figures) on top of a language you may already know.

## Your paper becomes a website

MyST doesn't generate static HTML pages — it builds an interactive web application. This means readers get client-side navigation between sections, hover previews for references and citations, and a responsive layout that works well on any device. The same source also exports to PDF, so you don't have to choose between a good web experience and a traditional document.

## A structured document, not just text

Unlike tools such as LaTeX or plain Markdown, MyST parses your document into an Abstract Syntax Tree (AST) — a structured representation of your content where every heading, paragraph, citation, and figure is a distinct, labeled node. This means the tooling can understand *what* each piece of your document is, not just how it looks, enabling automatic validation, format-independent rendering, and cross-referencing across documents. For example, a single `myst.yml` configuration can produce both a website and a PDF from the same source, because the output is generated from the AST rather than by reformatting raw text.

## Open and reproducible

Your paper lives in a git repository. Every edit is tracked, every version is recoverable, and anyone can inspect the source. There are no opaque binary formats — just plain text files that work with standard tools. This aligns with how open science should work.

## Compatible with scholarly publishing

MyST can export to JATS XML, the standard format used by scholarly publishers and indexed by services like PubMed and CrossRef. This means your micropublication is machine-readable and interoperable with existing publishing infrastructure from the start.

## Built by and for the open science community

MyST is developed by the Executable Books community alongside Curvenote, and is closely tied to the Jupyter ecosystem. It is built in the open, with the needs of researchers and scientific publishers in mind.
