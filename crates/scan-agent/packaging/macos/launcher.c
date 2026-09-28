/*
 * Main executable of "GMED Scan.app": opens Terminal with the interactive
 * scan station (Contents/Resources/station.command) and exits.
 *
 * A native universal binary rather than a shell script: Launch Services
 * treats a script app as an Intel app on Apple silicon and may ask to
 * install Rosetta first. Built by build-pkg.sh.
 */
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Cut the last path component off `path` in place; 0 when there is none. */
static int strip_last(char *path) {
    char *slash = strrchr(path, '/');
    if (slash == NULL || slash == path) {
        return 0;
    }
    *slash = '\0';
    return 1;
}

int main(void) {
    char executable[PATH_MAX];
    uint32_t size = sizeof executable;
    if (_NSGetExecutablePath(executable, &size) != 0) {
        fprintf(stderr, "GMED Scan: executable path too long\n");
        return 1;
    }
    char contents[PATH_MAX];
    if (realpath(executable, contents) == NULL) {
        perror("GMED Scan: realpath");
        return 1;
    }
    /* .../GMED Scan.app/Contents/MacOS/GMED Scan -> .../GMED Scan.app/Contents */
    if (!strip_last(contents) || !strip_last(contents)) {
        fprintf(stderr, "GMED Scan: unexpected app layout: %s\n", contents);
        return 1;
    }
    char command[PATH_MAX];
    int length = snprintf(command, sizeof command, "%s/Resources/station.command", contents);
    if (length < 0 || (size_t)length >= sizeof command) {
        fprintf(stderr, "GMED Scan: path too long\n");
        return 1;
    }
    execl("/usr/bin/open", "open", "-a", "Terminal", command, (char *)NULL);
    perror("GMED Scan: open");
    return 1;
}
