#module_parameters()(IMPORT_BASIC := true);

// This adds the basic import with the program parameters
// to the main program. Since aparently the the Basic import
// has already been loaded. It should throw an error which it does not.
// Instead it compiles fine and the program parameters are not set.
// Which is a problem.

#run {
  #import "Compiler"; // It also seems this uses a Basic import aswell?
  // #import "Basic"; // does this work or does this count as part of the program?
  w := get_current_workspace();
  write_string("w=");
  write_number(w);
  write_string(": inserting generating basic import\n");
  add_build_string(tprint("_ :: #import \"Basic\"()(MEMORY_DEBUGGERr=%, ENABLE_ASSERT=%, TEMP_ALLOCATOR_POISON_FREED_MEMORY=%);\nCOMPILE_PROGRAM :: %;"
                          , true
                          , true
                          , true
                          , w != 2)
                    , w);
  add_build_string("BLOCKER :: true;", w, code=MY_MODULE_SCOPE);
}
// #placeholder BLOCKER;
#run {
  write_strings("BLOCKER = ");
  write_number(xx BLOCKER);
  write_strings("\n");
}
MY_MODULE_SCOPE :: #code {};

#if 1
{
#if IMPORT_BASIC 
{
  #run {
    write_strings("w=");
    write_number(get_current_workspace());
    write_strings(": IMPORT_BASIC\n");
  }
  #scope_export
  using BASIC :: #import "Basic";
} 
else 
{
  #run {
    write_strings("w=");
    write_number(get_current_workspace());
    write_strings(": IMPORT_BASIC\n");
  }
  #scope_module
  using BASIC :: #import "Basic";
}

}