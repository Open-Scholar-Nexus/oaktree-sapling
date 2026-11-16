(ref-zenodo-record)=
# The Zenodo record

`oak release` fills a version's Zenodo record from the paper's `myst.yml` and the journal's [`zenodo:` settings](../guide/journal-yml.md#zenodo-community).

(zenodo-authors)=
## Authors

Each entry in `project.authors` becomes one of the record's creators, with its family and given name, every affiliation and the ORCID.

A `name` written as its parts, such as `given` and `family` (MyST's [author fields](https://mystmd.org/guide/frontmatter#frontmatter-authors) list the others), keeps those parts. A `name` written as one string is split the way MyST splits it:

- `Ada Lovelace` has the family name `Lovelace` and the given name `Ada`: the last word is the family name.
- `Vincent van Gogh` has the family name `van Gogh`: a lowercase word before the last one goes with the family name.
- `Lovelace, Ada` has the family name `Lovelace`: everything before the comma is the family name.

A family name of two words, such as `García Márquez`, needs `name` written as its parts, or as `García Márquez, Gabriel`.

An affiliation is a name, or the `id` of an entry in `project.affiliations`. The deposit leaves out the template's placeholder ORCID (`0000-0000-0000-0000`) and an ORCID that is not well formed, and prints a warning for each.
