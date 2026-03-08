TIMESTAMP := $(shell date +%Y%m%d.%H%M%S)
ZIP_NAME := empower-sorter-$(TIMESTAMP).zip

# Explicit allow list
PACKAGE_FILES := manifest.json content.js icons/icon-16.png icons/icon-48.png icons/icon-128.png

.PHONY: all clean

all: clean $(ZIP_NAME)

$(ZIP_NAME):
	@echo "Creating archive: $(ZIP_NAME)"
	@zip $(ZIP_NAME) $(PACKAGE_FILES)

clean:
	@echo "Removing archive builds..."
	@rm -f empower-sorter-*.zip
