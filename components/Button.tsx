import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  isLoading?: boolean;
  theme?: 'light' | 'dark';
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  isLoading, 
  className = '', 
  theme = 'dark',
  ...props 
}) => {
  const baseStyles = "px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed text-sm";
  
  const isDark = theme === 'dark';

  const variants = {
    primary: "bg-[#5C6BC0] text-white hover:bg-[#4E5BA3] shadow-lg shadow-[#5C6BC0]/20 active:scale-95",
    secondary: isDark 
      ? "bg-zinc-800 text-indigo-400 hover:bg-zinc-700 border border-zinc-700" 
      : "bg-[#5C6BC0]/10 text-[#5C6BC0] hover:bg-[#5C6BC0]/20 border border-[#5C6BC0]/20",
    outline: isDark 
      ? "border-2 border-zinc-700 text-zinc-300 hover:border-indigo-500 hover:text-indigo-400 active:scale-95" 
      : "border-2 border-[#E0E4F0] text-[#2D2D2D] hover:border-[#5C6BC0] hover:text-[#5C6BC0] active:scale-95",
    ghost: isDark 
      ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" 
      : "text-[#1A237E] hover:bg-[#5C6BC0]/5 hover:text-[#5C6BC0]"
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${className}`}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading && (
        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      )}
      {children}
    </button>
  );
};