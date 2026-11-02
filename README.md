# Inspire AI

Inspire reads your Unity Catalog metadata, turns it into a catalog of business use cases, and helps you build them, all inside your Databricks workspace. The installer sets up the Inspire App and its agent from the latest release, and it also works in a workspace that cannot reach the internet. Inspire is provided as is under the Apache 2.0 license and is not supported through Databricks support channels; ask questions on the Issues page of this repo.

1. Download the installer from the latest release: https://github.com/amralieg/inspire/releases/latest/download/inspire_installer.py
2. Import it into a folder of your Databricks workspace (Workspace, Import, File).
3. Run it with Run All, then follow what it shows: pick the SQL warehouse and the Inspire catalog, and run it again.

This repo holds everything Inspire is built from: the App in `app/` and the Inspire agent notebook, its App shell, tests and release tools in `app/agent/`.
