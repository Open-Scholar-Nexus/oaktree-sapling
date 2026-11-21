(ref-zenodo-authors)=
# Authors on Zenodo

`oak release` reads the paper's `project.authors` with MyST's own frontmatter parser and sends each author to the Zenodo draft with their family and given name, affiliations and ORCID.

A `name` written as its parts, such as `given` and `family` (MyST's [author fields](https://mystmd.org/guide/frontmatter#frontmatter-authors) list the others), keeps those parts. A `name` written as one string, or as `literal`, is split the way MyST splits it:

- `Ada Lovelace` has the family name `Lovelace` and the given name `Ada`: the last word is the family name.
- `Vincent van Gogh` has the family name `van Gogh`: a lowercase word before the last one goes with the family name.
- `Lovelace, Ada` has the family name `Lovelace`: everything before the comma is the family name.

A family name of two words, such as `García Márquez`, needs `name` written as its parts, or as `García Márquez, Gabriel`. A name with a suffix, such as `Martin Luther King Jr.`, needs its parts too, with `suffix: Jr.`, which Zenodo gets as part of the family name. A group author, such as `The XYZ Consortium`, needs `name` written with `family` only, so Zenodo keeps the whole name.

An affiliation is a name, or the `id` of an entry in `project.affiliations`. The deposit leaves out the template's placeholder ORCID (`0000-0000-0000-0000`) and an ORCID that is not well formed, and prints a warning for each.
