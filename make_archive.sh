#!/bin/bash

tar --exclude='node_modules' \
    --exclude='.next' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='*.tar' \
    --exclude='*.tar.gz' \
    -czvf ~/Downloads/jalal_source.tar.gz .
